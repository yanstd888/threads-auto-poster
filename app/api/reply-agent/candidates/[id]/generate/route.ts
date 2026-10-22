import { NextRequest, NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { requireAuth, requireSameOrigin } from '@/lib/auth';
import { generateReplyCandidate } from '@/lib/reply-agent';

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });
  initDB();
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Candidate id tidak valid' }, { status: 400 });
  const result = await generateReplyCandidate(id);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 422 });
  return NextResponse.json(result);
}
