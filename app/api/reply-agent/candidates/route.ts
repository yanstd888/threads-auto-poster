import { NextRequest, NextResponse } from 'next/server';
import { getDb, initDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { listReplyCandidates } from '@/lib/reply-candidates';

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initDB();
  const params = new URL(req.url).searchParams;
  const status = params.get('status') || undefined;
  const limit = Number(params.get('limit') || '50');
  return NextResponse.json({ candidates: listReplyCandidates(getDb(), status, limit) });
}
