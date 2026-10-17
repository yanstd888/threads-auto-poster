import { getDb, logAudit } from './db';
import { fetchMetrics } from './threads-api';

export function captureDueSnapshots(db: ReturnType<typeof getDb>, postId: number, metrics: { views: number; likes: number; replies: number; reposts: number; quotes: number; shares: number }, now: number) {
  const postedAt = db.prepare('SELECT posted_at FROM posts WHERE id = ?').get(postId) as { posted_at: number | null } | undefined;
  if (!postedAt?.posted_at) return;
  for (const [checkpoint, delay] of [['1h', 60 * 60_000], ['24h', 24 * 60 * 60_000], ['7d', 7 * 24 * 60 * 60_000]] as const) {
    if (now < postedAt.posted_at + delay) continue;
    db.prepare('INSERT OR IGNORE INTO metric_snapshots (post_id, checkpoint, views, likes, replies, reposts, quotes, shares, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(postId, checkpoint, metrics.views, metrics.likes, metrics.replies, metrics.reposts, metrics.quotes, metrics.shares, now);
  }
}

export async function captureDueSnapshotsForAll() {
  const db = getDb();
  const now = Date.now();
  const posts = db.prepare(`
    SELECT p.id, p.threads_id FROM posts p
    WHERE p.status IN ('posted', 'posted_unverified') AND p.threads_id IS NOT NULL AND p.posted_at IS NOT NULL
      AND (
        (p.posted_at <= ? AND NOT EXISTS (SELECT 1 FROM metric_snapshots s WHERE s.post_id = p.id AND s.checkpoint = '1h')) OR
        (p.posted_at <= ? AND NOT EXISTS (SELECT 1 FROM metric_snapshots s WHERE s.post_id = p.id AND s.checkpoint = '24h')) OR
        (p.posted_at <= ? AND NOT EXISTS (SELECT 1 FROM metric_snapshots s WHERE s.post_id = p.id AND s.checkpoint = '7d'))
      )
    ORDER BY p.posted_at ASC
  `).all(now - 60 * 60_000, now - 24 * 60 * 60_000, now - 7 * 24 * 60 * 60_000) as { id: number; threads_id: string }[];
  let captured = 0;
  for (const post of posts) {
    const metrics = await fetchMetrics(post.threads_id);
    if (!metrics) continue;
    db.prepare(`INSERT INTO metrics (post_id, views, likes, replies, reposts, quotes, shares, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(post_id) DO UPDATE SET views = excluded.views, likes = excluded.likes, replies = excluded.replies, reposts = excluded.reposts, quotes = excluded.quotes, shares = excluded.shares, updated_at = excluded.updated_at`)
      .run(post.id, metrics.views, metrics.likes, metrics.replies, metrics.reposts, metrics.quotes, metrics.shares, now);
    captureDueSnapshots(db, post.id, metrics, now);
    captured++;
  }
  if (captured) logAudit('metrics_snapshots_backfill', `checked=${posts.length} captured=${captured}`);
  return { checked: posts.length, captured };
}

export async function syncRecentThreadMetrics() {
  const db = getDb();
  const posts = db.prepare(`
    SELECT id, threads_id, posted_at FROM posts
    WHERE status IN ('posted', 'posted_unverified') AND threads_id IS NOT NULL
    ORDER BY posted_at DESC LIMIT 50
  `).all() as { id: number; threads_id: string; posted_at: number | null }[];
  let updated = 0;
  for (const post of posts) {
    const metrics = await fetchMetrics(post.threads_id);
    if (!metrics) continue;
    db.prepare(`
      INSERT INTO metrics (post_id, views, likes, replies, reposts, quotes, shares, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(post_id) DO UPDATE SET
        views = excluded.views, likes = excluded.likes, replies = excluded.replies,
        reposts = excluded.reposts, quotes = excluded.quotes, shares = excluded.shares, updated_at = excluded.updated_at
    `).run(post.id, metrics.views, metrics.likes, metrics.replies, metrics.reposts, metrics.quotes, metrics.shares, Date.now());
    captureDueSnapshots(db, post.id, metrics, Date.now());
    updated++;
  }
  logAudit('metrics_sync', `checked=${posts.length} updated=${updated}`);
  return { checked: posts.length, updated };
}
