import crypto from 'crypto';
import { getDb, getSetting } from './db';

export interface ApprovedSource {
  id: number;
  name: string;
  url: string;
  source_type: string;
}

export interface SourceContext {
  urls: string[];
  resourceUrls: string[];
  text: string;
}

export function getApprovedSources(pillar: string): ApprovedSource[] {
  return getDb().prepare(
    'SELECT id, name, url, source_type FROM sources WHERE pillar = ? AND approved = 1 ORDER BY COALESCE(last_checked, 0) ASC, id DESC',
  ).all(pillar) as unknown as ApprovedSource[];
}

const MAX_CONTEXT_SOURCES = 2;
const MAX_SOURCE_FETCH_CANDIDATES = 4;
const MAX_SOURCE_BODY_BYTES = 100_000;
const MAX_SOURCE_EXCERPT_CHARS = 1_200;

export function saveSourceSnapshot(db: ReturnType<typeof getDb>, sourceId: number, text: string, now = Date.now(), ttlMs = snapshotTtlMs()): number {
  const sha256 = crypto.createHash('sha256').update(text).digest('hex');
  return Number(db.prepare('INSERT OR IGNORE INTO source_snapshots (source_id, data, fetched_at, sha256, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(sourceId, text, now, sha256, now + ttlMs).changes);
}

export function pruneExpiredSourceSnapshots(db: ReturnType<typeof getDb>, now = Date.now()): number {
  return Number(db.prepare('DELETE FROM source_snapshots WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now).changes);
}

export function selectSourcesForContext(sources: ApprovedSource[], maxSources = MAX_CONTEXT_SOURCES, requireGitHubResource = false): ApprovedSource[] {
  const selected: ApprovedSource[] = [];
  const selectedHosts = new Set<string>();
  const add = (source: ApprovedSource) => {
    if (selected.some(item => item.id === source.id)) return;
    selected.push(source);
    selectedHosts.add(sourceHost(source.url));
  };

  const resources = sources.filter(source => isGitHubRepositoryUrl(source.url));
  if (requireGitHubResource) {
    for (const resource of resources) {
      if (selected.length >= maxSources) return selected;
      add(resource);
    }
  } else if (resources[0]) add(resources[0]);

  // ponytail: three distinct hosts give the hook broader evidence without re-growing the prompt.
  for (const source of sources) {
    if (selected.length >= maxSources) return selected;
    if (!selectedHosts.has(sourceHost(source.url))) add(source);
  }
  for (const source of sources) {
    if (selected.length >= maxSources) break;
    add(source);
  }
  return selected;
}

export function selectSourceFetchBatches(sources: ApprovedSource[], requireGitHubResource = false): ApprovedSource[][] {
  const candidates = selectSourcesForContext(sources, Math.min(sources.length, MAX_SOURCE_FETCH_CANDIDATES), requireGitHubResource);
  return Array.from({ length: Math.ceil(candidates.length / MAX_CONTEXT_SOURCES) }, (_, index) =>
    candidates.slice(index * MAX_CONTEXT_SOURCES, (index + 1) * MAX_CONTEXT_SOURCES),
  );
}

export async function fetchCurrentSourceContext(sources: ApprovedSource[], requireGitHubResource = false): Promise<SourceContext | { error: string }> {
  const usable: { url: string; text: string }[] = [];
  for (const selectedSources of selectSourceFetchBatches(sources, requireGitHubResource)) {
    const fetched = await Promise.all(selectedSources.map(async source => {
      const db = getDb();
      const now = Date.now();
      db.prepare('UPDATE sources SET last_checked = ? WHERE id = ?').run(now, source.id);
      try {
        const response = await fetch(sourceFetchUrl(source.url), {
          headers: { 'User-Agent': 'ThreadsAutoPoster/1.0 (+local content preparation)', 'Accept': 'application/vnd.github+json, text/html;q=0.9, */*;q=0.8' },
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) return fallbackSnapshot(source, sourceResponseHealth(source, response.status), response.status);
        const body = await readLimitedResponseText(response);
        // ponytail: bound source text before regex cleaning so one remote page cannot monopolize Node.
        const text = cleanSourceText(body).slice(0, MAX_SOURCE_EXCERPT_CHARS);
        if (text.length < 200) return fallbackSnapshot(source, 'dead', response.status, 'short_content');
        const expiresAt = now + snapshotTtlMs();
        saveSourceSnapshot(db, source.id, text, now, expiresAt - now);
        recordSourceHealth(source.id, 'live', response.status, body.length);
        return formatSourceContext(source, text, 'live');
      } catch (error) {
        const status = isRedirectError(error) ? 'redirect' : 'transient';
        return fallbackSnapshot(source, status, undefined, String((error as Error)?.message || error));
      }
    }));
    usable.push(...fetched.filter((item): item is { url: string; text: string } => Boolean(item)));
    if (usable.length >= MAX_CONTEXT_SOURCES) break;
  }
  const contextSources = usable.slice(0, MAX_CONTEXT_SOURCES);
  if (contextSources.length === 0) return { error: 'Tidak ada source approved yang bisa diambil saat ini' };
  const urls = contextSources.map(item => item.url);
  return { urls, resourceUrls: urls.filter(isGitHubRepositoryUrl), text: contextSources.map(item => item.text).join('\n\n---\n\n') };
}

export async function readLimitedResponseText(response: Response, maxBytes = MAX_SOURCE_BODY_BYTES): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let remaining = maxBytes;
  let text = '';
  try {
    while (remaining > 0) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      text += decoder.decode(chunk, { stream: true });
      remaining -= chunk.byteLength;
      if (remaining === 0 || chunk.byteLength < value.byteLength) {
        void reader.cancel();
        break;
      }
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function snapshotTtlMs(): number {
  return Math.max(60_000, Number(getSetting('source_snapshot_ttl_ms')) || 900_000);
}

function recordSourceHealth(sourceId: number, status: 'live' | 'transient' | 'dead' | 'redirect' | 'snapshot', httpStatus?: number, contentBytes?: number, errorKind?: string) {
  try {
    getDb().prepare('INSERT INTO source_health (source_id, checked_at, status, http_status, content_bytes, error_kind) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sourceId, Date.now(), status, httpStatus ?? null, contentBytes ?? null, errorKind ?? null);
  } catch {
    // ponytail: telemetry must not turn an otherwise safe source fallback into a generation failure.
  }
}

function fallbackSnapshot(source: ApprovedSource, status: 'transient' | 'dead' | 'redirect', httpStatus?: number, errorKind?: string): { url: string; text: string } | null {
  recordSourceHealth(source.id, status, httpStatus, undefined, errorKind);
  if (status !== 'transient') return null;
  const row = getDb().prepare('SELECT data FROM source_snapshots WHERE source_id = ? AND expires_at > ? ORDER BY fetched_at DESC LIMIT 1')
    .get(source.id, Date.now()) as { data: string } | undefined;
  if (!row) return null;
  const text = cleanSourceText(row.data).slice(0, MAX_SOURCE_EXCERPT_CHARS);
  if (text.length < 200) return null;
  recordSourceHealth(source.id, 'snapshot');
  return formatSourceContext(source, text, 'snapshot');
}

function formatSourceContext(source: ApprovedSource, text: string, mode: 'live' | 'snapshot') {
  return { url: source.url, text: `SOURCE${mode === 'snapshot' ? ' (approved snapshot)' : ''}: ${source.name} (${source.source_type})\nURL: ${source.url}\nFETCHED: ${new Date().toISOString()}\nEXCERPT:\n${text}` };
}

function isRedirectError(error: unknown): boolean {
  return /redirect|3(?:01|02|07|08)/i.test(String((error as Error)?.cause || (error as Error)?.message || error));
}

export function sourceResponseHealth(source: ApprovedSource, status: number): 'transient' | 'dead' {
  // ponytail: GitHub returns 403 for temporary unauthenticated API quota exhaustion.
  return status >= 500 || (status === 403 && isGitHubRepositoryUrl(source.url)) ? 'transient' : 'dead';
}

function sourceFetchUrl(value: string): string {
  try {
    const url = new URL(value);
    const [owner, repo] = url.pathname.split('/').filter(Boolean);
    if (url.hostname === 'github.com' && owner && repo && url.pathname.split('/').filter(Boolean).length === 2) {
      return `https://api.github.com/repos/${owner}/${repo}`;
    }
  } catch {}
  return value;
}

function sourceHost(value: string): string {
  try {
    return new URL(value).hostname.toLocaleLowerCase('en-US');
  } catch {
    return value;
  }
}

function isGitHubRepositoryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === 'github.com' && url.pathname.split('/').filter(Boolean).length === 2;
  } catch {
    return false;
  }
}

function cleanSourceText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(?:x[0-9a-f]+|\d+);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
