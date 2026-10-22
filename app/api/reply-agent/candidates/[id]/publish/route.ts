import { NextRequest, NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { requireAuth, requireSameOrigin } from '@/lib/auth';
import { publishReplyCandidate } from '@/lib/reply-publish';

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });
  initDB();
  const id = Number((await context.params).id);
  const body = await req.json().catch(() => ({})) as { auto?: unknown };
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Candidate id tidak valid' }, { status: 400 });
  const result = await publishReplyCandidate(id, body.auto === true);
  const status = result.kind === 'posted' || result.kind === 'already_posted' ? 200 : result.kind === 'disabled' ? 403 : result.kind === 'not_found' ? 404 : result.kind === 'publish_unknown' ? 409 : 422;
  return NextResponse.json(result, { status });
}
