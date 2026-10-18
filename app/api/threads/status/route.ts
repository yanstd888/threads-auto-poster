import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getFreshThreadsToken } from '@/lib/threads-api';

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = await getFreshThreadsToken();
  if ('error' in token) {
    return NextResponse.json({ connected: false, error: token.error });
  }

  try {
    const res = await fetch(
      `https://graph.threads.net/v1.0/me?fields=id,username,name&access_token=${token.token}`
    );
    const data = await res.json();
    if (data.error) {
      return NextResponse.json({ connected: false, error: data.error.message });
    }
    return NextResponse.json({
      connected: true,
      username: data.username,
      id: data.id,
      expiresAt: token.expiresAt,
      requiresReconnect: !token.expiresAt,
    });
  } catch (error: unknown) {
    return NextResponse.json({ connected: false, error: error instanceof Error ? error.message : String(error) });
  }
}
