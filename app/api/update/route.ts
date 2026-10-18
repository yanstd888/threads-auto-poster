import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getLatestUpdate } from '@/lib/update-check';

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await getLatestUpdate());
  } catch {
    return NextResponse.json({ error: 'Update check unavailable' }, { status: 503 });
  }
}
