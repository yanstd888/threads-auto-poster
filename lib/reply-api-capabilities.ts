import { getSetting, logAudit } from './db';
import { getFreshThreadsToken } from './threads-api';

export const THREADS_REPLY_SCOPES = [
  'threads_basic',
  'threads_content_publish',
  'threads_manage_replies',
  'threads_read_replies',
  'threads_keyword_search',
  'threads_profile_discovery',
] as const;

export const THREADS_REPLY_FIELDS = [
  'id',
  'text',
  'media_type',
  'permalink',
  'timestamp',
  'username',
  'topic_tag',
  'has_replies',
  'is_quote_post',
  'is_reply',
  'reply_audience',
].join(',');

export const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

type ThreadsErrorKind = 'scope_missing' | 'quota_exhausted' | 'target_restricted' | 'target_deleted' | 'discovery_transient' | 'api_error';

export interface ThreadsApiError {
  error: string;
  kind: ThreadsErrorKind;
  status?: number;
}

export type ThreadsApiResult<T> = { ok: true; data: T } | { ok: false; error: ThreadsApiError };

export interface ThreadsIdentity {
  id: string;
  username?: string;
  name?: string;
}

export interface ThreadsPublicProfile {
  id: string;
  username: string;
  name?: string;
  threads_biography?: string;
  is_verified?: boolean;
}

export interface ThreadsPublicPost {
  id: string;
  text: string;
  media_type?: string;
  permalink?: string;
  timestamp?: string;
  username?: string;
  topic_tag?: string;
  has_replies?: boolean;
  is_quote_post?: boolean;
  is_reply?: boolean;
  is_reply_owned_by_me?: boolean;
  root_post?: { id: string };
  replied_to?: { id: string };
  reply_audience?: string;
}

export interface ReplyQuota {
  quotaUsage: number;
  quotaTotal: number;
  quotaDuration: number;
  remaining: number;
}

export interface ReplyCapabilityReport {
  checkedAt: number;
  connected: boolean;
  username?: string;
  accountId?: string;
  keywordSearch: { supported: boolean; reason?: string };
  profileDiscovery: { supported: boolean; reason?: string };
  replyPublishing: { supported: boolean; reason?: string };
  replyQuota: ReplyQuota | null;
  quotaError?: string;
}

export interface SearchInput {
  query: string;
  searchMode: 'KEYWORD' | 'TAG';
  searchType?: 'TOP' | 'RECENT';
  authorUsername?: string;
  since?: number;
  until?: number;
  limit?: number;
}

export interface ProfilePostsInput {
  username: string;
  since?: number;
  until?: number;
  limit?: number;
}

export async function getThreadsIdentity(): Promise<ThreadsApiResult<ThreadsIdentity>> {
  return requestThreadsJson<ThreadsIdentity>('/me', { fields: 'id,username,name' });
}

export async function lookupThreadsProfile(username: string): Promise<ThreadsApiResult<ThreadsPublicProfile>> {
  return requestThreadsJson<ThreadsPublicProfile>('/profile_lookup', { username, fields: 'id,username,name,threads_biography,is_verified' });
}

export async function fetchThreadsProfilePosts(input: ProfilePostsInput): Promise<ThreadsApiResult<ThreadsPublicPost[]>> {
  const result = await requestThreadsJson<{ data?: unknown[] }>('/profile_posts', {
    username: input.username,
    fields: THREADS_REPLY_FIELDS,
    limit: String(clampLimit(input.limit)),
    ...(input.since ? { since: String(input.since) } : {}),
    ...(input.until ? { until: String(input.until) } : {}),
  });
  if (!result.ok) return result;
  return { ok: true, data: normalizePostList(result.data.data) };
}

export async function searchThreadsPosts(input: SearchInput): Promise<ThreadsApiResult<ThreadsPublicPost[]>> {
  const result = await requestThreadsJson<{ data?: unknown[] }>('/keyword_search', {
    q: input.query,
    search_mode: input.searchMode,
    search_type: input.searchType || 'RECENT',
    media_type: 'TEXT',
    fields: THREADS_REPLY_FIELDS,
    limit: String(clampLimit(input.limit)),
    ...(input.authorUsername ? { author_username: input.authorUsername } : {}),
    ...(input.since ? { since: String(input.since) } : {}),
    ...(input.until ? { until: String(input.until) } : {}),
  });
  if (!result.ok) return result;
  return { ok: true, data: normalizePostList(result.data.data) };
}

export async function fetchThreadsConversation(rootThreadId: string): Promise<ThreadsApiResult<ThreadsPublicPost[]>> {
  const id = rootThreadId.trim();
  if (!id) return { ok: false, error: { kind: 'api_error', error: 'Root conversation ID wajib diisi' } };
  const fields = `${THREADS_REPLY_FIELDS},root_post,replied_to,is_reply_owned_by_me`;
  const result = await requestThreadsJson<{ data?: unknown[] }>(`/${encodeURIComponent(id)}/conversation`, {
    fields,
    reverse: 'false',
  });
  if (!result.ok) return result;
  return { ok: true, data: normalizePostList(result.data.data) };
}

export async function getReplyPublishingLimit(): Promise<ThreadsApiResult<ReplyQuota>> {
  const identity = await getThreadsIdentity();
  if (!identity.ok) return { ok: false, error: identity.error };
  const result = await requestThreadsJson<Record<string, unknown>>(`/${identity.data.id}/threads_publishing_limit`, {
    fields: 'quota_usage,config,reply_quota_usage,reply_config',
  });
  if (!result.ok) return result;
  const row = Array.isArray(result.data.data) ? result.data.data[0] : result.data;
  const parsed = parseReplyQuota(row);
  return parsed ? { ok: true, data: parsed } : {
    ok: false,
    error: { kind: 'api_error', error: 'Meta tidak mengembalikan reply_quota_usage/reply_config yang valid' },
  };
}

export async function probeReplyCapabilities(): Promise<ReplyCapabilityReport> {
  const checkedAt = Date.now();
  const identity = await getThreadsIdentity();
  if (!identity.ok) {
    const reason = identity.error.error;
    return {
      checkedAt,
      connected: false,
      keywordSearch: { supported: false, reason },
      profileDiscovery: { supported: false, reason },
      replyPublishing: { supported: false, reason },
      replyQuota: null,
      quotaError: reason,
    };
  }

  const [keyword, profile, quota] = await Promise.all([
    searchThreadsPosts({ query: '__threads_reply_capability_probe__', searchMode: 'KEYWORD', searchType: 'RECENT', limit: 1 }),
    lookupThreadsProfile(identity.data.username || getSetting('threads_username') || '__threads_reply_capability_probe__'),
    getReplyPublishingLimit(),
  ]);
  const keywordSupported = keyword.ok;
  const profileSupported = profile.ok;
  const replySupported = quota.ok;
  const quotaError = quota.ok ? undefined : quota.error.error;
  logAudit('reply_capability_probe', `keyword=${keywordSupported} profile=${profileSupported} publish=${replySupported} quota=${quota.ok}`);
  return {
    checkedAt,
    connected: true,
    username: identity.data.username,
    accountId: identity.data.id,
    keywordSearch: { supported: keywordSupported, ...(keyword.ok ? {} : { reason: keyword.error.error }) },
    profileDiscovery: { supported: profileSupported, ...(profile.ok ? {} : { reason: profile.error.error }) },
    replyPublishing: { supported: replySupported, ...(quota.ok ? {} : { reason: quota.error.error }) },
    replyQuota: quota.ok ? quota.data : null,
    quotaError,
  };
}

export async function fetchReplyMetrics(replyId: string): Promise<ThreadsApiResult<Partial<Record<'views' | 'likes' | 'replies' | 'reposts' | 'quotes' | 'shares', number>>>> {
  const result = await requestThreadsJson<{ data?: Array<{ name?: string; values?: Array<{ value?: unknown }>; total_value?: { value?: unknown } }> }>(`/${encodeURIComponent(replyId)}/insights`, {
    metric: 'views,likes,replies,reposts,quotes,shares',
  });
  if (!result.ok) return result;
  const metrics: Partial<Record<'views' | 'likes' | 'replies' | 'reposts' | 'quotes' | 'shares', number>> = {};
  for (const item of result.data.data || []) {
    if (!item.name || !['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'].includes(item.name)) continue;
    const value = Number(item.values?.[0]?.value ?? item.total_value?.value);
    if (Number.isFinite(value)) metrics[item.name as keyof typeof metrics] = value;
  }
  return { ok: true, data: metrics };
}

export function createReplyContainerUrl(userId: string, accessToken: string, text: string, targetThreadId: string): URL {
  const targetId = targetThreadId.trim();
  if (!targetId) throw new Error('reply_to_id wajib untuk publish reply');
  const url = new URL(`${THREADS_API_BASE}/${encodeURIComponent(userId)}/threads`);
  url.searchParams.set('media_type', 'TEXT');
  url.searchParams.set('text', text);
  url.searchParams.set('reply_to_id', targetId);
  url.searchParams.set('access_token', accessToken);
  return url;
}

export function parseReplyQuota(data: unknown): ReplyQuota | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  const config = row.reply_config;
  if (!config || typeof config !== 'object') return null;
  const usage = Number(row.reply_quota_usage);
  const total = Number((config as Record<string, unknown>).quota_total);
  const duration = Number((config as Record<string, unknown>).quota_duration);
  if (!Number.isInteger(usage) || !Number.isInteger(total) || total <= 0 || !Number.isInteger(duration) || duration <= 0) return null;
  return { quotaUsage: usage, quotaTotal: total, quotaDuration: duration, remaining: Math.max(0, total - usage) };
}

export function classifyThreadsError(status: number | undefined, payload: unknown, fallback = 'Threads API request failed'): ThreadsApiError {
  const row = payload && typeof payload === 'object' ? payload as { error?: { message?: unknown; code?: unknown; type?: unknown } } : {};
  const message = typeof row.error?.message === 'string' ? row.error.message : fallback;
  const code = String(row.error?.code || '');
  const lower = `${message} ${code} ${String(row.error?.type || '')}`.toLowerCase();
  const kind: ThreadsErrorKind = /permission|scope|oauth|access token|(#10|#200)/i.test(lower)
    ? 'scope_missing'
    : /quota|rate limit|too many|limit reached/i.test(lower)
      ? 'quota_exhausted'
      : /reply control|not allowed to reply|cannot reply|restricted/i.test(lower)
        ? 'target_restricted'
        : /not found|deleted|unavailable|does not exist/i.test(lower)
          ? 'target_deleted'
          : status && status >= 500 ? 'discovery_transient' : 'api_error';
  return { error: message, kind, ...(status ? { status } : {}) };
}

async function requestThreadsJson<T>(path: string, params: Record<string, string>): Promise<ThreadsApiResult<T>> {
  const token = await getFreshThreadsToken();
  if ('error' in token) return { ok: false, error: { kind: 'scope_missing', error: token.error } };
  const url = new URL(`${THREADS_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('access_token', token.token);
  try {
    const response = await fetch(url.toString());
    const payload: unknown = await response.json();
    if (!response.ok || (payload && typeof payload === 'object' && 'error' in payload)) {
      return { ok: false, error: classifyThreadsError(response.status, payload) };
    }
    return { ok: true, data: payload as T };
  } catch (error: unknown) {
    return { ok: false, error: classifyThreadsError(undefined, undefined, error instanceof Error ? error.message : 'Threads request failed') };
  }
}

function normalizePostList(value: unknown): ThreadsPublicPost[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => normalizePost(item));
}

function normalizePost(value: unknown): ThreadsPublicPost[] {
  if (!value || typeof value !== 'object') return [];
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.text !== 'string' || !row.text.trim()) return [];
  return [{
    id: row.id,
    text: row.text.trim(),
    media_type: typeof row.media_type === 'string' ? row.media_type : undefined,
    permalink: typeof row.permalink === 'string' ? row.permalink : undefined,
    timestamp: typeof row.timestamp === 'string' ? row.timestamp : undefined,
    username: typeof row.username === 'string' ? row.username : undefined,
    topic_tag: typeof row.topic_tag === 'string' ? row.topic_tag : undefined,
    has_replies: typeof row.has_replies === 'boolean' ? row.has_replies : undefined,
    is_quote_post: typeof row.is_quote_post === 'boolean' ? row.is_quote_post : undefined,
    is_reply: typeof row.is_reply === 'boolean' ? row.is_reply : undefined,
    is_reply_owned_by_me: typeof row.is_reply_owned_by_me === 'boolean' ? row.is_reply_owned_by_me : undefined,
    root_post: normalizePostReference(row.root_post),
    replied_to: normalizePostReference(row.replied_to),
    reply_audience: typeof row.reply_audience === 'string' ? row.reply_audience : undefined,
  }];
}

function normalizePostReference(value: unknown): { id: string } | undefined {
  if (!value || typeof value !== 'object' || typeof (value as Record<string, unknown>).id !== 'string') return undefined;
  return { id: (value as Record<string, string>).id };
}

function clampLimit(value?: number): number {
  return Math.min(100, Math.max(1, Number.isInteger(value) ? (value as number) : 25));
}
