import { getDb, logAudit } from './db';
import { fetchReplyMetrics } from './reply-api-capabilities';

export async function syncReplyMetrics(limit = 50): Promise<{ checked: number; updated: number }> {
  const db = getDb();
  const candidates = db.prepare(`
    SELECT id, reply_thread_id, published_at FROM reply_candidates
    WHERE status = 'posted' AND reply_thread_id IS NOT NULL
    ORDER BY published_at DESC LIMIT ?
  `).all(Math.min(100, Math.max(1, limit))) as Array<{ id: number; reply_thread_id: string; published_at: number | null }>;
  let updated = 0;
  for (const candidate of candidates) {
    const result = await fetchReplyMetrics(candidate.reply_thread_id);
    if (!result.ok) continue;
    const values = result.data;
    const now = Date.now();
    db.prepare(`
      INSERT INTO reply_metrics (candidate_id, views, likes, replies, reposts, quotes, shares, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(candidate_id) DO UPDATE SET views = excluded.views, likes = excluded.likes, replies = excluded.replies,
        reposts = excluded.reposts, quotes = excluded.quotes, shares = excluded.shares, updated_at = excluded.updated_at
    `).run(candidate.id, values.views ?? null, values.likes ?? null, values.replies ?? null, values.reposts ?? null, values.quotes ?? null, values.shares ?? null, now);
    captureReplySnapshots(db, candidate.id, candidate.published_at, values, now);
    updated += 1;
  }
  logAudit('reply_metrics_sync', `checked=${candidates.length} updated=${updated}`);
  return { checked: candidates.length, updated };
}

export function captureReplySnapshots(
  db: ReturnType<typeof getDb>,
  candidateId: number,
  publishedAt: number | null,
  metrics: Partial<Record<'views' | 'likes' | 'replies' | 'reposts' | 'quotes' | 'shares', number>>,
  now = Date.now(),
): void {
  if (!publishedAt) return;
  for (const [checkpoint, delay] of [['1h', 60 * 60_000], ['24h', 24 * 60 * 60_000], ['7d', 7 * 24 * 60 * 60_000]] as const) {
    if (now < publishedAt + delay) continue;
    db.prepare(`
      INSERT OR IGNORE INTO reply_metric_snapshots
        (candidate_id, checkpoint, views, likes, replies, reposts, quotes, shares, captured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(candidateId, checkpoint, metrics.views ?? null, metrics.likes ?? null, metrics.replies ?? null, metrics.reposts ?? null, metrics.quotes ?? null, metrics.shares ?? null, now);
  }
}

export function getReplyAnalytics() {
  const db = getDb();
  const status = db.prepare('SELECT status, COUNT(*) AS count FROM reply_candidates GROUP BY status ORDER BY status').all() as Array<{ status: string; count: number }>;
  const byTarget = db.prepare(`
    SELECT c.target_type, c.target_username, COUNT(*) AS posted, AVG(c.relevance_score) AS avg_relevance,
      SUM(CASE WHEN s.checkpoint = '24h' THEN 1 ELSE 0 END) AS snapshots_24h,
      AVG(CASE WHEN s.checkpoint = '24h' THEN s.views END) AS avg_views
    FROM reply_candidates c
    LEFT JOIN reply_metric_snapshots s ON s.candidate_id = c.id
    WHERE c.status = 'posted'
    GROUP BY c.target_type, c.target_username
    ORDER BY posted DESC
  `).all() as Array<Record<string, unknown>>;
  const byMechanism = db.prepare(`
    SELECT COALESCE(reply_mechanism, 'unknown') AS mechanism, COUNT(*) AS posted,
      AVG(relevance_score) AS avg_relevance, AVG((SELECT views FROM reply_metrics m WHERE m.candidate_id = c.id)) AS avg_views
    FROM reply_candidates c WHERE status = 'posted' GROUP BY reply_mechanism ORDER BY posted DESC
  `).all() as Array<Record<string, unknown>>;
  const snapshots24h = Number((db.prepare("SELECT COUNT(*) AS count FROM reply_metric_snapshots WHERE checkpoint = '24h'").get() as { count: number }).count);
  return {
    status: status.map(row => ({ status: row.status, count: Number(row.count) })),
    byTarget: byTarget.map(row => normalizeAnalyticsRow(row)),
    byMechanism: byMechanism.map(row => normalizeAnalyticsRow(row)),
    evidenceMinimum: 10,
    snapshots24h,
    rankingEligible: snapshots24h >= 10,
    note: snapshots24h >= 10 ? 'Segmen boleh dibandingkan sebagai tie-breaker.' : 'Belum cukup bukti; minimum 10 snapshot 24 jam sebelum ranking segmen.',
  };
}

function normalizeAnalyticsRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'number' ? value : value == null ? null : String(value)]));
}
