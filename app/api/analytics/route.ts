import { NextRequest, NextResponse } from 'next/server';
import { getDb, initDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

const PAGE_SIZE = 10;
const MIN_LEARNING_SAMPLE = 5;

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initDB();
  const db = getDb();
  const requestedPage = Number(new URL(req.url).searchParams.get('page') || '1');
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const total = db.prepare('SELECT COUNT(*) as count FROM posts').get() as { count: number };
  const posted = db.prepare("SELECT COUNT(*) as count FROM posts WHERE status = 'posted'").get() as { count: number };
  const pending = db.prepare("SELECT COUNT(*) as count FROM posts WHERE status = 'draft' OR status = 'scheduled'").get() as { count: number };
  const failed = db.prepare("SELECT COUNT(*) as count FROM posts WHERE status = 'failed' OR status = 'quality_failed'").get() as { count: number };

  const byPillar = db.prepare(
    'SELECT pillar, COUNT(*) as count, SUM(CASE WHEN status = \'posted\' THEN 1 ELSE 0 END) as posted_count FROM posts GROUP BY pillar'
  ).all() as any[];

  const byStatus = db.prepare(
    'SELECT status, COUNT(*) as count FROM posts GROUP BY status'
  ).all() as any[];

  const recentMetricsTotal = db.prepare("SELECT COUNT(*) as count FROM posts WHERE status = 'posted'").get() as { count: number };
  const recentMetricsTotals = db.prepare(`
    SELECT COALESCE(SUM(m.views), 0) AS views, COALESCE(SUM(m.likes), 0) AS likes,
      COALESCE(SUM(m.replies), 0) AS replies, COALESCE(SUM(m.reposts), 0) AS reposts,
      COALESCE(SUM(m.quotes), 0) AS quotes, COALESCE(SUM(m.shares), 0) AS shares
    FROM posts p LEFT JOIN metrics m ON m.post_id = p.id WHERE p.status = 'posted'
  `).get() as { views: number; likes: number; replies: number; reposts: number; quotes: number; shares: number };
  const totalPages = Math.max(1, Math.ceil(recentMetricsTotal.count / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const recentMetrics = db.prepare(`
    SELECT p.pillar, p.created_at, m.views, m.likes, m.replies, m.reposts, m.quotes, m.shares
    FROM posts p
    LEFT JOIN metrics m ON m.post_id = p.id
    WHERE p.status = 'posted'
    ORDER BY p.created_at DESC LIMIT ? OFFSET ?
  `).all(PAGE_SIZE, (currentPage - 1) * PAGE_SIZE) as any[];

  const learning = db.prepare(`
    SELECT a.hook_mechanism AS dimension, COUNT(*) AS sample_size,
      ROUND(AVG(s.replies + s.quotes), 2) AS avg_conversations, ROUND(AVG(s.reposts + s.shares), 2) AS avg_redistribution
    FROM post_attributes a
    JOIN metric_snapshots s ON s.post_id = a.post_id AND s.checkpoint = '24h'
    GROUP BY a.hook_mechanism HAVING COUNT(*) >= ? ORDER BY avg_conversations DESC, avg_redistribution DESC
  `).all(MIN_LEARNING_SAMPLE);
  const formatLearning = db.prepare(`
    SELECT a.content_format AS dimension, COUNT(*) AS sample_size,
      ROUND(AVG(s.replies + s.quotes), 2) AS avg_conversations, ROUND(AVG(s.reposts + s.shares), 2) AS avg_redistribution
    FROM post_attributes a
    JOIN metric_snapshots s ON s.post_id = a.post_id AND s.checkpoint = '24h'
    GROUP BY a.content_format HAVING COUNT(*) >= ? ORDER BY avg_redistribution DESC, avg_conversations DESC
  `).all(MIN_LEARNING_SAMPLE);
  const learningSample = db.prepare("SELECT COUNT(*) AS count FROM metric_snapshots WHERE checkpoint = '24h'").get() as { count: number };

  return NextResponse.json({
    totals: {
      all: total.count,
      posted: posted.count,
      pending: pending.count,
      failed: failed.count,
    },
    byPillar,
    byStatus,
    recentMetrics,
    recentMetricsPagination: { page: currentPage, totalPages, total: recentMetricsTotal.count },
    recentMetricsTotals,
    learning: { minimumSample: MIN_LEARNING_SAMPLE, sample24h: learningSample.count, hooks: learning, formats: formatLearning },
  });
}
