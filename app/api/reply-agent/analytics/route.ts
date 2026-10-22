import { NextRequest, NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { requireAuth, requireSameOrigin } from '@/lib/auth';
import { getReplyAnalytics, syncReplyMetrics } from '@/lib/reply-analytics';

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initDB();
  return NextResponse.json(getReplyAnalytics());
}

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });
  initDB();
  const result = await syncReplyMetrics();
  return NextResponse.json({ ...result, analytics: getReplyAnalytics() });
}
