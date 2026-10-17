import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForToken, exchangeLongLivedToken } from '@/lib/threads-oauth';
import { initDB, logAudit, setSetting } from '@/lib/db';
import { saveToken } from '@/lib/threads-api';

const OAUTH_STATE_COOKIE = 'threads-oauth-state';

function validState(expected?: string, received?: string): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function redirectDashboard(req: NextRequest, path: string): NextResponse {
  const origin = process.env.THREADS_OAUTH_REDIRECT_URI
    ? new URL(process.env.THREADS_OAUTH_REDIRECT_URI).origin
    : process.env.APP_PUBLIC_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const response = NextResponse.redirect(new URL(path, origin), { status: 302 });
  response.cookies.set(OAUTH_STATE_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth/threads/callback',
    maxAge: 0,
  });
  return response;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');
  const dashboard = '/dashboard/credentials';

  initDB();
  if (!validState(req.cookies.get(OAUTH_STATE_COOKIE)?.value, state ?? undefined)) {
    logAudit('threads_oauth_state_invalid', 'callback rejected');
    return redirectDashboard(req, `${dashboard}?oauth_error=invalid_state`);
  }

  if (error) {
    return redirectDashboard(req, `${dashboard}?oauth_error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return redirectDashboard(req, `${dashboard}?oauth_error=no_code`);
  }

  const initialToken = await exchangeCodeForToken(code);
  if ('error' in initialToken) {
    logAudit('threads_oauth_error', initialToken.error);
    return redirectDashboard(req, `${dashboard}?oauth_error=${encodeURIComponent(initialToken.error)}`);
  }
  const tokenRes = await exchangeLongLivedToken(initialToken.access_token);
  if ('error' in tokenRes || !tokenRes.expires_in) {
    const error = 'error' in tokenRes ? tokenRes.error : 'Token Threads tidak memiliki masa berlaku';
    logAudit('threads_oauth_error', error);
    return redirectDashboard(req, `${dashboard}?oauth_error=${encodeURIComponent(error)}`);
  }

  const expiresAt = Date.now() + tokenRes.expires_in * 1000;
  saveToken('threads', tokenRes.access_token, expiresAt);

  // Ambil username dari API
  try {
    const meRes = await fetch(
      `https://graph.threads.net/v1.0/me?fields=id,username&access_token=${tokenRes.access_token}`
    );
    const meData = await meRes.json();
    if (meData.username) setSetting('threads_username', meData.username);
  } catch {}

  logAudit('threads_oauth_success', `token saved, expires_in=${tokenRes.expires_in ?? 'n/a'}`);
  return redirectDashboard(req, `${dashboard}?oauth_success=1`);
}
