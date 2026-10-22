import { NextRequest, NextResponse } from 'next/server';
import { getDb, initDB, logAudit } from '@/lib/db';
import { requireAuth, requireSameOrigin } from '@/lib/auth';
import { addReplyTarget, deleteReplyTarget, getReplyTargets, updateReplyTarget, type ReplyTargetInput } from '@/lib/reply-targets';

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initDB();
  return NextResponse.json({ targets: getReplyTargets(getDb()) });
}

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });
  initDB();
  const result = addReplyTarget(await req.json() as ReplyTargetInput, getDb());
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
  logAudit('reply_target_added', `target=${result.id} type=${result.target_type}`);
  return NextResponse.json({ target: result }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });
  initDB();
  const body = await req.json() as { id?: unknown } & Partial<ReplyTargetInput>;
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Target id tidak valid' }, { status: 400 });
  const result = updateReplyTarget(id, body, getDb());
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
  logAudit('reply_target_updated', `target=${id}`);
  return NextResponse.json({ target: result });
}

export async function DELETE(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });
  initDB();
  const id = Number((await req.json()).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Target id tidak valid' }, { status: 400 });
  if (!deleteReplyTarget(id, getDb())) return NextResponse.json({ error: 'Target tidak ditemukan' }, { status: 404 });
  logAudit('reply_target_disabled', `target=${id}`);
  return NextResponse.json({ success: true });
}
