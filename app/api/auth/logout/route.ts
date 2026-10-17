import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireSameOrigin } from '@/lib/auth';

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });
  const response = NextResponse.json({ success: true });
  response.cookies.set('auth-token', '', { path: '/', maxAge: 0 });
  return response;
}
