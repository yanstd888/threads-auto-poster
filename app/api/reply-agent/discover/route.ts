import { NextRequest, NextResponse } from 'next/server';
import { getDb, initDB, logAudit } from '@/lib/db';
import { requireAuth, requireSameOrigin } from '@/lib/auth';
import { discoverReplyPosts } from '@/lib/reply-discovery';
import { runReplyDiscoveryCycle } from '@/lib/reply-agent';

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });
  initDB();
  const body = await req.json().catch(() => ({})) as { preview?: unknown; maxTargets?: unknown };
  if (body.preview === true) {
    const result = await discoverReplyPosts(getDb(), Math.min(12, Math.max(1, Number(body.maxTargets) || 12)));
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 422 });
    return NextResponse.json({
      preview: true,
      targets: result.targets,
      requests: result.requests,
      errors: result.errors.map(error => ({ targetId: error.targetId, message: error.message, kind: error.kind })),
      posts: result.discovered.slice(0, 100).map(item => ({
        id: item.post.id,
        username: item.post.username,
        text: item.post.text,
        permalink: item.post.permalink,
        timestamp: item.post.timestamp,
        targetType: item.targetType,
        targetLabel: item.targetLabel,
        query: item.query,
      })),
    });
  }
  const result = await runReplyDiscoveryCycle();
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 409 });
  logAudit('reply_discovery_manual', `inserted=${result.inserted}`);
  return NextResponse.json(result);
}
