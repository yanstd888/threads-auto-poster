import { getDb, getSetting, logAudit, setSetting } from './db';
import { refreshLongLivedToken } from './threads-oauth';
import crypto from 'crypto';

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

// ponytail: preserve the existing 32-byte derivation so valid saved tokens stay valid.
// Missing config must fail closed; a random fallback makes tokens undecryptable after restart.
function encryptionKey(): string {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret || Buffer.byteLength(secret.slice(0, 32), 'utf8') !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY wajib ada dan minimal 32 byte.');
  }
  return secret.slice(0, 32);
}

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(encryptionKey()), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text: string): string {
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encryptionKey()), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function saveToken(service: string, token: string, expiresAt?: number) {
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO tokens (id, service, encrypted_token, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET encrypted_token = excluded.encrypted_token, expires_at = excluded.expires_at, updated_at = excluded.updated_at
  `).run(`${service}_main`, service, encrypt(token), expiresAt ?? null, now, now);

  // Also save username if provided via settings
  // ponytail: threads_username stored in settings table
}

export function disconnectThreads(): void {
  const db = getDb();
  db.prepare('DELETE FROM tokens WHERE id = ?').run('threads_main');
  setSetting('threads_username', '');
  logAudit('threads_disconnected', 'local token removed');
}

export function getToken(service: string): { token: string; expiresAt?: number } | { error: string } {
  const db = getDb();
  const row = db.prepare('SELECT encrypted_token, expires_at FROM tokens WHERE service = ?').get(service) as { encrypted_token: string; expires_at: number | null } | undefined;
  if (!row) return { error: 'Threads token belum tersimpan' };
  try {
    return { token: decrypt(row.encrypted_token), expiresAt: row.expires_at ?? undefined };
  } catch {
    logAudit('token_decrypt_failed', `service=${service} key mismatch`);
    return { error: 'Gagal dekrip token — TOKEN_ENCRYPTION_KEY berbeda dari saat token disimpan. Set TOKEN_ENCRYPTION_KEY di .env.local lalu hubungkan ulang.' };
  }
}

const THREADS_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function shouldRefreshThreadsToken(expiresAt?: number, now = Date.now()): boolean {
  return Boolean(expiresAt && expiresAt > now && expiresAt - now <= THREADS_REFRESH_WINDOW_MS);
}

export async function getFreshThreadsToken(): Promise<{ token: string; expiresAt?: number } | { error: string }> {
  const current = getToken('threads');
  if ('error' in current || !current.expiresAt) return current;
  if (current.expiresAt <= Date.now()) return { error: 'Sesi Threads sudah kedaluwarsa. Hubungkan ulang.' };
  if (!shouldRefreshThreadsToken(current.expiresAt)) return current;

  const refreshed = await refreshLongLivedToken(current.token);
  if ('error' in refreshed || !refreshed.access_token || !refreshed.expires_in) {
    const error = 'error' in refreshed ? refreshed.error : 'Respons refresh token Threads tidak valid';
    logAudit('threads_token_refresh_failed', error);
    return { error: `Sesi Threads perlu dihubungkan ulang: ${error}` };
  }

  const expiresAt = Date.now() + refreshed.expires_in * 1000;
  saveToken('threads', refreshed.access_token, expiresAt);
  logAudit('threads_token_refreshed', `expires_at=${expiresAt}`);
  return { token: refreshed.access_token, expiresAt };
}

export type ThreadsPublishResult =
  | { id: string; url: string; verified: boolean; replyIds: string[] }
  | { partial: true; id: string; url: string; verified: boolean; replyIds: string[]; error: string }
  | { error: string; safeToRetry: boolean };

export interface ThreadsPublishingLimit {
  quotaUsage: number;
  quotaTotal: number;
  quotaDuration: number;
}

export function parseThreadsPublishingLimit(data: unknown): ThreadsPublishingLimit | null {
  const row = Array.isArray((data as { data?: unknown[] })?.data) ? (data as { data: unknown[] }).data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const value = row as { quota_usage?: unknown; config?: { quota_total?: unknown; quota_duration?: unknown } };
  const quotaUsage = Number(value.quota_usage);
  const quotaTotal = Number(value.config?.quota_total);
  const quotaDuration = Number(value.config?.quota_duration);
  return Number.isInteger(quotaUsage) && Number.isInteger(quotaTotal) && quotaTotal > 0 && Number.isInteger(quotaDuration) && quotaDuration > 0
    ? { quotaUsage, quotaTotal, quotaDuration }
    : null;
}

async function getThreadsPublishingLimit(userId: string, accessToken: string): Promise<ThreadsPublishingLimit | { error: string }> {
  const url = new URL(`${THREADS_API_BASE}/${userId}/threads_publishing_limit`);
  url.searchParams.set('fields', 'quota_usage,config');
  url.searchParams.set('access_token', accessToken);
  const response = await fetch(url.toString());
  const data = await response.json();
  const limit = response.ok ? parseThreadsPublishingLimit(data) : null;
  return limit || { error: data?.error?.message || 'Threads publishing limit tidak tersedia' };
}

export function createThreadsContainerUrl(userId: string, accessToken: string, text: string, replyToId?: string, topicTag?: string): URL {
  const url = new URL(`${THREADS_API_BASE}/${userId}/threads`);
  url.searchParams.set('media_type', 'TEXT');
  url.searchParams.set('text', text);
  if (replyToId) url.searchParams.set('reply_to_id', replyToId);
  if (topicTag && !replyToId) url.searchParams.set('topic_tag', topicTag);
  url.searchParams.set('access_token', accessToken);
  return url;
}

export async function postToThreads(post: { text: string; replies: string[]; topicTag?: string }): Promise<ThreadsPublishResult> {
  const token = await getFreshThreadsToken();
  if ('error' in token) {
    logAudit('threads_post_skipped', token.error);
    return { error: token.error, safeToRetry: true };
  }

  const accessToken = token.token;
  try {
    // Meta publishing flow needs the actual Threads user ID for both endpoints.
    const meUrl = new URL(`${THREADS_API_BASE}/me`);
    meUrl.searchParams.set('fields', 'id,username');
    meUrl.searchParams.set('access_token', accessToken);
    const meRes = await fetch(meUrl.toString());
    const meData = await meRes.json();
    if (!meRes.ok || !meData.id) {
      const error = meData.error?.message || 'Failed to load Threads account';
      logAudit('threads_error', `identity: ${error}`);
      return { error, safeToRetry: true };
    }

    const limit = await getThreadsPublishingLimit(meData.id, accessToken);
    if ('error' in limit) {
      logAudit('threads_limit_error', limit.error);
      return { error: limit.error, safeToRetry: true };
    }
    if (limit.quotaUsage >= limit.quotaTotal) {
      const error = `Kuota root post Threads habis (${limit.quotaUsage}/${limit.quotaTotal} dalam ${Math.round(limit.quotaDuration / 3600)} jam)`;
      logAudit('threads_limit_reached', error);
      return { error, safeToRetry: true };
    }

    // Step 1: Create media container.
    let containerRes = await fetch(createThreadsContainerUrl(meData.id, accessToken, post.text, undefined, post.topicTag).toString(), { method: 'POST' });
    let containerData = await containerRes.json();
    if ((!containerRes.ok || !containerData.id) && post.topicTag) {
      // ponytail: an unavailable topic tag must not prevent a reviewed post from publishing.
      logAudit('threads_topic_tag_fallback', `topic_tag=${post.topicTag} ${containerData.error?.message || containerRes.status}`);
      containerRes = await fetch(createThreadsContainerUrl(meData.id, accessToken, post.text).toString(), { method: 'POST' });
      containerData = await containerRes.json();
    }
    if (!containerRes.ok || !containerData.id) {
      const error = containerData.error?.message || 'Failed to create container';
      logAudit('threads_error', `container: ${error}`);
      return { error, safeToRetry: true };
    }

    // Step 2: Publish the created container.
    const publishUrl = new URL(`${THREADS_API_BASE}/${meData.id}/threads_publish`);
    publishUrl.searchParams.set('creation_id', containerData.id);
    publishUrl.searchParams.set('access_token', accessToken);
    const publishRes = await fetch(publishUrl.toString(), { method: 'POST' });
    const publishData = await publishRes.json();
    if (!publishRes.ok || !publishData.id) {
      const error = publishData.error?.message || 'Failed to publish';
      logAudit('threads_error', `publish: ${error}`);
      return { error, safeToRetry: true };
    }

    const fallbackUrl = `https://www.threads.net/@${meData.username || getSetting('threads_username') || 'your_threads_username'}/post/${publishData.id}`;
    const verifyUrl = new URL(`${THREADS_API_BASE}/${publishData.id}`);
    verifyUrl.searchParams.set('fields', 'id,permalink');
    verifyUrl.searchParams.set('access_token', accessToken);
    const verifyRes = await fetch(verifyUrl.toString());
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok || verifyData.id !== publishData.id) {
      const error = verifyData.error?.message || 'Read-back failed after publish';
      logAudit('threads_verify_error', `id=${publishData.id} ${error}`);
      return { id: publishData.id, url: fallbackUrl, verified: false, replyIds: [] };
    }

    let parentId = publishData.id;
    const replyIds: string[] = [];
    for (const reply of post.replies.filter(Boolean)) {
      const replyContainerRes = await fetch(createThreadsContainerUrl(meData.id, accessToken, reply, parentId).toString(), { method: 'POST' });
      const replyContainer = await replyContainerRes.json();
      if (!replyContainerRes.ok || !replyContainer.id) {
        const error = replyContainer.error?.message || 'Failed to create reply container';
        logAudit('threads_error', `reply_container: ${error}`);
        return { partial: true, id: publishData.id, url: verifyData.permalink || fallbackUrl, verified: true, replyIds, error };
      }
      const replyPublishUrl = new URL(publishUrl);
      replyPublishUrl.searchParams.set('creation_id', replyContainer.id);
      const replyPublishRes = await fetch(replyPublishUrl.toString(), { method: 'POST' });
      const replyPublish = await replyPublishRes.json();
      if (!replyPublishRes.ok || !replyPublish.id) {
        const error = replyPublish.error?.message || 'Failed to publish reply';
        logAudit('threads_error', `reply_publish: ${error}`);
        return { partial: true, id: publishData.id, url: verifyData.permalink || fallbackUrl, verified: true, replyIds, error };
      }
      const replyVerifyUrl = new URL(`${THREADS_API_BASE}/${replyPublish.id}`);
      replyVerifyUrl.searchParams.set('fields', 'id');
      replyVerifyUrl.searchParams.set('access_token', accessToken);
      const replyVerifyRes = await fetch(replyVerifyUrl.toString());
      const replyVerify = await replyVerifyRes.json();
      if (!replyVerifyRes.ok || replyVerify.id !== replyPublish.id) {
        const error = replyVerify.error?.message || 'Read-back failed after reply publish';
        logAudit('threads_verify_error', `reply=${replyPublish.id} ${error}`);
        return { partial: true, id: publishData.id, url: verifyData.permalink || fallbackUrl, verified: true, replyIds, error };
      }
      replyIds.push(replyPublish.id);
      parentId = replyPublish.id;
    }

    logAudit('threads_posted', `id=${publishData.id} replies=${post.replies.filter(Boolean).length}`);
    return { id: publishData.id, url: verifyData.permalink || fallbackUrl, verified: true, replyIds };
  } catch (error: unknown) {
    // ponytail: a network failure can happen after Meta accepted a publish; never replay blindly.
    const message = error instanceof Error ? error.message : 'Threads request failed';
    logAudit('threads_error', message);
    return { error: message, safeToRetry: false };
  }
}

export type ThreadsReplyPublishResult =
  | { id: string; url: string; verified: boolean }
  | { id?: string; url?: string; error: string; safeToRetry: boolean; ambiguous: boolean; status?: number };

export async function postReplyToThreads(text: string, replyToId: string): Promise<ThreadsReplyPublishResult> {
  const targetId = replyToId.trim();
  if (!targetId) return { error: 'reply_to_id wajib untuk publish reply', safeToRetry: false, ambiguous: false };
  const token = await getFreshThreadsToken();
  if ('error' in token) return { error: token.error, safeToRetry: true, ambiguous: false };
  try {
    const meUrl = new URL(`${THREADS_API_BASE}/me`);
    meUrl.searchParams.set('fields', 'id,username');
    meUrl.searchParams.set('access_token', token.token);
    const meResponse = await fetch(meUrl.toString());
    const meData: unknown = await meResponse.json();
    if (!meResponse.ok || !isRecord(meData) || typeof meData.id !== 'string') {
      return { error: readThreadsError(meData, 'Failed to load Threads account'), safeToRetry: meResponse.status < 500, ambiguous: meResponse.status >= 500, status: meResponse.status };
    }

    const containerUrl = createThreadsContainerUrl(meData.id, token.token, text, targetId);
    const containerResponse = await fetch(containerUrl.toString(), { method: 'POST' });
    const containerData: unknown = await containerResponse.json();
    if (!containerResponse.ok || !isRecord(containerData) || typeof containerData.id !== 'string') {
      return { error: readThreadsError(containerData, 'Failed to create reply container'), safeToRetry: containerResponse.status < 500, ambiguous: containerResponse.status >= 500, status: containerResponse.status };
    }

    const publishUrl = new URL(`${THREADS_API_BASE}/${meData.id}/threads_publish`);
    publishUrl.searchParams.set('creation_id', containerData.id);
    publishUrl.searchParams.set('access_token', token.token);
    const publishResponse = await fetch(publishUrl.toString(), { method: 'POST' });
    const publishData: unknown = await publishResponse.json();
    if (!publishResponse.ok || !isRecord(publishData) || typeof publishData.id !== 'string') {
      return { error: readThreadsError(publishData, 'Failed to publish reply'), safeToRetry: publishResponse.status < 500, ambiguous: publishResponse.status >= 500, status: publishResponse.status };
    }

    const fallbackUrl = `https://www.threads.net/@${typeof meData.username === 'string' ? meData.username : getSetting('threads_username') || 'your_threads_username'}/post/${publishData.id}`;
    const verifyUrl = new URL(`${THREADS_API_BASE}/${publishData.id}`);
    verifyUrl.searchParams.set('fields', 'id,permalink');
    verifyUrl.searchParams.set('access_token', token.token);
    const verifyResponse = await fetch(verifyUrl.toString());
    const verifyData: unknown = await verifyResponse.json();
    if (!verifyResponse.ok || !isRecord(verifyData) || verifyData.id !== publishData.id || typeof verifyData.permalink !== 'string') {
      return { id: publishData.id, url: fallbackUrl, error: readThreadsError(verifyData, 'Read-back failed after reply publish'), safeToRetry: false, ambiguous: true, status: verifyResponse.status };
    }
    return { id: publishData.id, url: verifyData.permalink, verified: true };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : 'Threads reply request failed', safeToRetry: false, ambiguous: true };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readThreadsError(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  const error = value.error;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return fallback;
}

export const THREADS_LIMITS = {
  TEXT_LIMIT: 500,
  MAX_POSTS_PER_HOUR: 200,
  MAX_MEDIA_URLS: 20,
};

export async function fetchMetrics(postId: string) {
  const token = await getFreshThreadsToken();
  if ('error' in token) return null;

  const url = new URL(`${THREADS_API_BASE}/${postId}/insights`);
  url.searchParams.set('metric', 'views,likes,replies,reposts,quotes,shares');
  url.searchParams.set('access_token', token.token);

  const res = await fetch(url.toString());
  if (!res.ok) {
    logAudit('metrics_error', `post=${postId} status=${res.status}`);
    return null;
  }
  const data = await res.json() as { data?: Array<{ name?: string; values?: Array<{ value?: number }>; total_value?: { value?: number } }> };
  const values = Object.fromEntries((data.data || []).filter(item => typeof item.name === 'string').map(item => [item.name, Number(item.values?.[0]?.value ?? item.total_value?.value ?? 0)]));
  return {
    id: postId,
    views: values.views || 0,
    likes: values.likes || 0,
    replies: values.replies || 0,
    reposts: values.reposts || 0,
    quotes: values.quotes || 0,
    shares: values.shares || 0,
  };
}
