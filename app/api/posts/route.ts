import { NextRequest, NextResponse } from 'next/server';
import { getDb, initDB, logAudit } from '@/lib/db';
import { requireAuth, requireSameOrigin } from '@/lib/auth';
import { createManualDraftPost } from '@/lib/schedule-content';
import { publishStoredPost, type PublishStoredPostResult } from '@/lib/publish';
import { saveToken } from '@/lib/threads-api';

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initDB();
  const db = getDb();
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  if (action === 'generate') return NextResponse.json({ error: 'Gunakan POST untuk membuat draft' }, { status: 405 });

  const posts = db.prepare(`
    SELECT id, pillar, post_type, content, replies, status, threads_url, created_at, posted_at, quality_status, quality_reasons, retry_count
    FROM posts ORDER BY created_at DESC LIMIT(50)
  `).all() as any[];
  return NextResponse.json({
    posts: posts.map(post => ({
      id: post.id,
      pillar: post.pillar,
      post_type: post.post_type,
      content: post.content,
      replies: post.replies ? JSON.parse(post.replies) : [],
      status: post.status,
      threads_url: post.threads_url,
      created_at: post.created_at,
      posted_at: post.posted_at,
      quality_status: post.quality_status,
      quality_reasons: post.quality_reasons,
      retry_count: post.retry_count,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });

  initDB();
  const db = getDb();
  const body = await req.json();
  const action = body.action;
  const postId = Number(body.postId);

  if (action === 'generate') {
    try {
      const created = await createManualDraftPost(body.pillar || 'github', (body.postType || 'education') as 'education' | 'promotion');
      if ('error' in created) return NextResponse.json({ error: created.error }, { status: 422 });
      const post = db.prepare('SELECT pillar, post_type, content, replies, source_urls, quality_status, quality_reasons FROM posts WHERE id = ?').get(created.postId) as any;
      logAudit('content_generated', `pillar=${post.pillar} quality=${post.quality_status}`);
      return NextResponse.json({
        content: { pillar: post.pillar, postType: post.post_type, text: post.content, replies: JSON.parse(post.replies || '[]'), sourceUrls: JSON.parse(post.source_urls || '[]') },
        quality: { passed: post.quality_status === 'passed', reasons: JSON.parse(post.quality_reasons || '[]') },
      });
    } catch (error: any) {
      logAudit('generate_error', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if ((action === 'approve' || action === 'retry') && Number.isInteger(postId) && postId > 0) {
    return publishResponse(await publishStoredPost(postId, action === 'approve' ? ['draft'] : ['failed']));
  }

  if (action === 'save_token') {
    await saveToken('threads', body.token, body.expiresAt);
    db.prepare("INSERT INTO settings (key, value) VALUES ('threads_username', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(body.username);
    logAudit('token_saved', 'threads');
    return NextResponse.json({ success: true });
  }

  if (action === 'delete' && Number.isInteger(postId) && postId > 0) {
    const result = db.prepare("DELETE FROM posts WHERE id = ? AND status <> 'publishing'").run(postId);
    if (result.changes === 0) return NextResponse.json({ error: 'Post tidak dapat dihapus saat sedang dikirim atau tidak ditemukan' }, { status: 409 });
    logAudit('post_deleted', `post ${postId}`);
    return NextResponse.json({ success: true });
  }

  if (action === 'bulk_approve') {
    const rawPostIds: unknown[] = Array.isArray(body.postIds) ? body.postIds : [];
    const ids = [...new Set(rawPostIds
      .map(value => Number(value))
      .filter((id): id is number => Number.isInteger(id) && id > 0))];
    const results = [];
    for (const id of ids) results.push({ id, ...(await publishStoredPost(id, ['draft'])) });
    return NextResponse.json({ results });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

function publishResponse(result: PublishStoredPostResult) {
  if (result.kind === 'posted') {
    return NextResponse.json({ success: true, id: result.id, url: result.url, verified: result.verified });
  }
  if (result.kind === 'already_posted') {
    return NextResponse.json({ error: 'Post ini sudah terkirim ke Threads', url: result.url }, { status: 409 });
  }
  if (result.kind === 'publishing') {
    return NextResponse.json({ error: 'Post sedang dikirim. Tunggu hasilnya; jangan kirim ulang.' }, { status: 409 });
  }
  if (result.kind === 'failed') {
    return NextResponse.json({ error: result.retryable ? result.error : 'Status publikasi tidak pasti. Jangan kirim ulang otomatis.' }, { status: 500 });
  }
  if (result.kind === 'not_publishable') {
    return NextResponse.json({ error: `Post tidak dapat dikirim dari status ${result.status}` }, { status: 409 });
  }
  return NextResponse.json({ error: 'Post not found' }, { status: 404 });
}
