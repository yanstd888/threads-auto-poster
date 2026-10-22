const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

function publicOrigin(): string {
  return process.env.APP_PUBLIC_URL || process.env.NEXTAUTH_URL || 'http://localhost:4000';
}

export function getThreadsAppConfig(): { appId: string; appSecret: string; redirectUri: string } | null {
  const appId = process.env.THREADS_APP_ID;
  const appSecret = process.env.THREADS_APP_SECRET;
  const redirectUri = process.env.THREADS_OAUTH_REDIRECT_URI || `${publicOrigin().replace(/\/$/, '')}/api/auth/threads/callback`;
  if (!appId || !appSecret) return null;
  return { appId, appSecret, redirectUri };
}

export interface ThreadsAuthorizeOptions {
  includeReplyDiscovery?: boolean;
}

export function buildAuthorizeUrl(state: string, options: ThreadsAuthorizeOptions = {}): string | null {
  const config = getThreadsAppConfig();
  if (!config) return null;
  const scopes = ['threads_basic', 'threads_content_publish', 'threads_manage_insights', 'threads_manage_replies'];
  if (options.includeReplyDiscovery) scopes.push('threads_keyword_search', 'threads_profile_discovery', 'threads_read_replies');
  const params = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    scope: scopes.join(','),
    response_type: 'code',
    state,
  });
  return `https://threads.net/oauth/authorize?${params.toString()}`;
}

export interface ThreadsTokenResult {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

export async function exchangeCodeForToken(code: string): Promise<ThreadsTokenResult | { error: string }> {
  const config = getThreadsAppConfig();
  if (!config) return { error: 'Threads app credentials belum diatur' };

  const body = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
    code,
  });

  try {
    const res = await fetch(`${THREADS_API_BASE}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json();
    return data.error ? { error: data.error_message || data.error } : data;
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Token exchange failed' };
  }
}

export async function exchangeLongLivedToken(accessToken: string): Promise<ThreadsTokenResult | { error: string }> {
  const config = getThreadsAppConfig();
  if (!config) return { error: 'Threads app credentials belum diatur' };
  const url = new URL(`${THREADS_API_BASE}/access_token`);
  url.searchParams.set('grant_type', 'th_exchange_token');
  url.searchParams.set('client_secret', config.appSecret);
  url.searchParams.set('access_token', accessToken);
  return requestToken(url);
}

export async function refreshLongLivedToken(accessToken: string): Promise<ThreadsTokenResult | { error: string }> {
  const url = new URL(`${THREADS_API_BASE}/refresh_access_token`);
  url.searchParams.set('grant_type', 'th_refresh_token');
  url.searchParams.set('access_token', accessToken);
  return requestToken(url);
}

async function requestToken(url: URL): Promise<ThreadsTokenResult | { error: string }> {
  try {
    const res = await fetch(url.toString());
    const data = await res.json();
    return data.error ? { error: data.error_message || data.error } : data;
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Token exchange failed' };
  }
}
