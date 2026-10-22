import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { buildAuthorizeUrl, getThreadsAppConfig } from '@/lib/threads-oauth';

const OAUTH_STATE_COOKIE = 'threads-oauth-state';

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = getThreadsAppConfig();
  if (!config) {
    return NextResponse.json({
      error: 'THREADS_APP_ID atau THREADS_APP_SECRET belum diatur',
      redirect_uri_expected: new URL('/api/auth/threads/callback', req.url).toString(),
    }, { status: 400 });
  }

  const state = crypto.randomBytes(32).toString('base64url');
  const url = buildAuthorizeUrl(state, { includeReplyDiscovery: req.nextUrl.searchParams.get('reply') === '1' });
  const response = NextResponse.redirect(url!, { status: 302 });
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth/threads/callback',
    maxAge: 10 * 60,
  });
  return response;
}
