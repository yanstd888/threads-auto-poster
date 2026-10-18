import { NextRequest, NextResponse } from 'next/server';
import { getDb, initDB, logAudit } from '@/lib/db';
import { requireAuth, requireSameOrigin } from '@/lib/auth';
import { isSafeSourceUrl } from '@/lib/source-url';
import { getContentPillar, isValidPillarSlug } from '@/lib/content-pillars';

const PAGE_SIZE_MAX = 100;

type SourceRow = {
  id: number; name: string; url: string; pillar: string; source_type: string;
  last_checked: number | null; approved: number; created_at: number;
  health_status: string | null; health_http_status: number | null; health_error: string | null;
};

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initDB();
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const requestedId = Number(params.get('id'));
  if (Number.isInteger(requestedId) && requestedId > 0 && params.get('history') === '1') {
    const history = db.prepare('SELECT checked_at, status, http_status, content_bytes, error_kind FROM source_health WHERE source_id = ? ORDER BY checked_at DESC LIMIT 50').all(requestedId);
    return NextResponse.json({ source_id: requestedId, history });
  }
  if (params.get('export') === '1') {
    const rows = db.prepare('SELECT name, url, pillar, source_type, approved FROM sources ORDER BY created_at ASC, id ASC').all() as Array<{ name: string; url: string; pillar: string; source_type: string; approved: number }>;
    const sources = rows.map(source => ({ ...source, approved: Boolean(source.approved) }));
    if (params.get('format') === 'csv') {
      const csv = ['name,url,pillar,source_type,approved', ...sources.map(source => [source.name, source.url, source.pillar, source.source_type, String(source.approved)].map(csvCell).join(','))].join('\n');
      return new NextResponse(`${csv}\n`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="sources.csv"' } });
    }
    return NextResponse.json({ format: 'threads-auto-poster-sources', schema_version: 1, exported_at: new Date().toISOString(), sources });
  }
  const page = Math.max(1, Number(params.get('page') || '1') || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(params.get('page_size') || '25') || 25));
  const q = (params.get('q') || '').trim();
  const pillar = (params.get('pillar') || '').trim();
  const status = (params.get('status') || '').trim();
  const sourceType = (params.get('source_type') || '').trim();
  const approved = params.get('approved');
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  if (q) { clauses.push('(s.name LIKE ? OR s.url LIKE ?)'); values.push(`%${q}%`, `%${q}%`); }
  if (pillar) { clauses.push('s.pillar = ?'); values.push(pillar); }
  if (sourceType) { clauses.push('s.source_type = ?'); values.push(sourceType); }
  if (approved === '0' || approved === '1') { clauses.push('s.approved = ?'); values.push(Number(approved)); }
  if (status) { clauses.push('COALESCE(h.status, \'unknown\') = ?'); values.push(status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = Number((db.prepare(`SELECT COUNT(*) AS count FROM sources s LEFT JOIN (SELECT source_id, status, ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY checked_at DESC) AS rank FROM source_health) h ON h.source_id = s.id AND h.rank = 1 ${where}`).get(...values) as { count: number }).count || 0);
  const offset = (page - 1) * pageSize;
  const sources = db.prepare(`
    SELECT s.id, s.name, s.url, s.pillar, s.source_type, s.last_checked, s.approved, s.created_at,
      h.status AS health_status, h.http_status AS health_http_status, h.error_kind AS health_error
    FROM sources s
    LEFT JOIN source_health h ON h.id = (SELECT id FROM source_health WHERE source_id = s.id ORDER BY checked_at DESC LIMIT 1)
    ${where}
    ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?
  `).all(...values, pageSize, offset) as SourceRow[];
  return NextResponse.json({ sources, pagination: { page, page_size: pageSize, total, pages: Math.ceil(total / pageSize) }, filters: { q, pillar, status, source_type: sourceType, approved } });
}

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });
  initDB();
  const db = getDb();
  const body = await req.json();
  if (body?.action === 'check') {
    const id = Number(body.id);
    const source = db.prepare('SELECT id, url FROM sources WHERE id = ?').get(id) as { id: number; url: string } | undefined;
    if (!source) return NextResponse.json({ error: 'Source tidak ditemukan' }, { status: 404 });
    const health = await checkSource(source.url);
    const now = Date.now();
    db.prepare('INSERT INTO source_health (source_id, checked_at, status, http_status, content_bytes, error_kind) VALUES (?, ?, ?, ?, ?, ?)').run(source.id, now, health.status, health.httpStatus, health.bytes, health.error);
    db.prepare('UPDATE sources SET last_checked = ? WHERE id = ?').run(now, source.id);
    logAudit('source_health_checked', `${source.id} ${health.status}`);
    return NextResponse.json({ success: true, health: { ...health, checked_at: now } });
  }
  if (body?.action === 'bulk_approve') {
    const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0) : [];
    if (!ids.length || typeof body.approved !== 'boolean') return NextResponse.json({ error: 'ids dan approved wajib diisi' }, { status: 400 });
    const placeholders = ids.map(() => '?').join(',');
    const result = db.prepare(`UPDATE sources SET approved = ? WHERE id IN (${placeholders})`).run(body.approved ? 1 : 0, ...ids);
    logAudit('sources_bulk_approval_updated', `${ids.length} approved=${body.approved}`);
    return NextResponse.json({ success: true, changed: Number(result.changes) });
  }
  if (body?.action === 'bulk_check') {
    const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0).slice(0, 100) : [];
    if (!ids.length) return NextResponse.json({ error: 'ids wajib diisi' }, { status: 400 });
    const results: Array<{ id: number; status: string; httpStatus: number | null; error: string | null }> = [];
    for (const id of ids) {
      const source = db.prepare('SELECT id, url FROM sources WHERE id = ?').get(id) as { id: number; url: string } | undefined;
      if (!source) continue;
      const health = await checkSource(source.url);
      const now = Date.now();
      db.prepare('INSERT INTO source_health (source_id, checked_at, status, http_status, content_bytes, error_kind) VALUES (?, ?, ?, ?, ?, ?)').run(source.id, now, health.status, health.httpStatus, health.bytes, health.error);
      db.prepare('UPDATE sources SET last_checked = ? WHERE id = ?').run(now, source.id);
      results.push({ id: source.id, status: health.status, httpStatus: health.httpStatus, error: health.error });
    }
    logAudit('sources_bulk_health_checked', `${results.length}`);
    return NextResponse.json({ success: true, results });
  }
  if (body?.action === 'import') {
    const rawSources = body.sources;
    if (!Array.isArray(rawSources) || rawSources.length > 10_000) return NextResponse.json({ error: 'sources tidak valid atau terlalu besar' }, { status: 400 });
    const seen = new Set<string>();
    const errors: Array<{ index: number; error: string }> = [];
    const sources: Array<{ name: string; url: string; pillar: string; source_type: string; approved: boolean }> = [];
    rawSources.forEach((raw: unknown, index: number) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push({ index, error: 'format tidak valid' }); return; }
      const value = raw as Record<string, unknown>;
      const name = typeof value.name === 'string' ? value.name.trim() : '';
      const url = typeof value.url === 'string' ? value.url.trim() : '';
      const pillar = typeof value.pillar === 'string' ? value.pillar.trim() : '';
      const sourceType = typeof value.source_type === 'string' ? value.source_type.trim() : 'manual';
      const approved = typeof value.approved === 'boolean' ? value.approved : Boolean(value.approved);
      if (!name || name.length > 160 || !isSafeSourceUrl(url) || !isValidPillarSlug(pillar) || !getContentPillar(pillar, db) || !sourceType || sourceType.length > 80) { errors.push({ index, error: 'name, url, pillar, atau source_type tidak valid' }); return; }
      if (seen.has(url)) { errors.push({ index, error: `URL duplikat dalam import: ${url}` }); return; }
      seen.add(url);
      sources.push({ name, url, pillar, source_type: sourceType, approved });
    });
    const dryRun = body.dry_run === true;
    if (errors.length || dryRun) return NextResponse.json({ dry_run: dryRun, valid: sources.length, imported: 0, errors });
    db.exec('BEGIN IMMEDIATE');
    try {
      const find = db.prepare('SELECT id FROM sources WHERE url = ? LIMIT 1');
      const update = db.prepare('UPDATE sources SET name = ?, pillar = ?, source_type = ?, approved = ? WHERE id = ?');
      const insert = db.prepare('INSERT INTO sources (name, url, pillar, source_type, last_checked, approved, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)');
      let imported = 0;
      for (const source of sources) {
        const existing = find.get(source.url) as { id: number } | undefined;
        if (existing) update.run(source.name, source.pillar, source.source_type, source.approved ? 1 : 0, existing.id);
        else insert.run(source.name, source.url, source.pillar, source.source_type, source.approved ? 1 : 0, Date.now());
        imported += 1;
      }
      db.exec('COMMIT');
      logAudit('sources_imported', `${imported}`);
      return NextResponse.json({ dry_run: false, valid: sources.length, imported, errors: [] });
    } catch (error) {
      db.exec('ROLLBACK');
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Import gagal' }, { status: 500 });
    }
  }
  const { name, url, pillar, source_type, approved } = body;
  if (typeof name !== 'string' || name.length === 0 || name.length > 160 || typeof pillar !== 'string' || !isValidPillarSlug(pillar) || !getContentPillar(pillar, db) || !isSafeSourceUrl(url)) {
    return NextResponse.json({ error: 'name, url, pillar required' }, { status: 400 });
  }
  const now = Date.now();
  const result = db.prepare('INSERT INTO sources (name, url, pillar, source_type, last_checked, approved, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)').run(name.trim(), url, pillar, typeof source_type === 'string' ? source_type.slice(0, 40) : 'manual', approved ? 1 : 0, now);
  logAudit('source_added', `${name} ${url}`);
  return NextResponse.json({ success: true, id: Number(result.lastInsertRowid) });
}

export async function DELETE(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'ID source tidak valid' }, { status: 400 });
  initDB();
  const db = getDb();
  const result = db.prepare('DELETE FROM sources WHERE id = ?').run(id);
  if (!result.changes) return NextResponse.json({ error: 'Source tidak ditemukan' }, { status: 404 });
  db.prepare('DELETE FROM source_health WHERE source_id = ?').run(id);
  logAudit('source_deleted', String(id));
  return NextResponse.json({ success: true });
}

export async function checkSource(url: string): Promise<{ status: 'live' | 'transient' | 'dead' | 'redirect'; httpStatus: number | null; bytes: number | null; error: string | null }> {
  try {
    let response = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8_000) });
    if (response.status === 403 || response.status === 405) {
      response = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-4095' }, redirect: 'manual', signal: AbortSignal.timeout(8_000) });
      await response.body?.cancel();
    }
    const status = response.status >= 300 && response.status < 400 ? 'redirect' : response.status >= 500 || response.status === 429 ? 'transient' : response.ok ? 'live' : 'dead';
    return { status, httpStatus: response.status, bytes: null, error: null };
  } catch (error) {
    return { status: 'transient', httpStatus: null, bytes: null, error: error instanceof Error ? error.name : 'fetch_error' };
  }
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
