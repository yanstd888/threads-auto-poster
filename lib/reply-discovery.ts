import type { DatabaseSync } from 'node:sqlite';
import { getDb, getSetting, logAudit } from './db';
import {
  fetchThreadsConversation,
  fetchThreadsProfilePosts,
  lookupThreadsProfile,
  searchThreadsPosts,
  type ThreadsPublicPost,
  type ThreadsApiError,
} from './reply-api-capabilities';
import {
  getFreeDiscoverySeeds,
  getReplyTargets,
  markReplyTargetScanned,
  selectReplyTargetsForDiscovery,
  type ReplyTarget,
} from './reply-targets';

export interface DiscoveredReplyPost {
  post: ThreadsPublicPost;
  targetId: number | null;
  targetType: ReplyTarget['target_type'];
  targetLabel: string;
  query: string;
  selectionReason: string;
  rootThreadId?: string;
  parentReplyThreadId?: string;
  isContinuation?: boolean;
}

export interface DiscoveryResult {
  discovered: DiscoveredReplyPost[];
  targets: number;
  requests: number;
  errors: Array<{ targetId: number; message: string; kind: ThreadsApiError['kind'] }>;
}

export async function discoverReplyPosts(db: DatabaseSync = getDb(), maxTargets = 12): Promise<DiscoveryResult | { error: string }> {
  const targets = getReplyTargets(db, true);
  if (!targets.length) return { error: 'Belum ada target reply aktif dengan bobot positif' };
  const selected = selectReplyTargetsForDiscovery(targets, maxTargets, `reply:${Math.floor(Date.now() / 900_000)}`);
  const discovered: DiscoveredReplyPost[] = [];
  const errors: DiscoveryResult['errors'] = [];
  let requests = 0;

  for (const target of selected) {
    const result = await discoverForTarget(target, db);
    if ('error' in result) {
      requests += result.requests;
      errors.push({ targetId: target.id, message: result.error.error, kind: result.error.kind });
      continue;
    }
    requests += result.requests;
    discovered.push(...result.posts);
    markReplyTargetScanned(target.id, Date.now(), db);
  }

  if (getSetting('reply_account_policy') === 'continuations_only') {
    const continuation = await discoverReplyContinuations(db);
    discovered.push(...continuation.posts);
    requests += continuation.requests;
    errors.push(...continuation.errors);
  }

  logAudit('reply_discovery_completed', `targets=${selected.length} requests=${requests} posts=${discovered.length} errors=${errors.length}`);
  return { discovered, targets: selected.length, requests, errors };
}

async function discoverForTarget(target: ReplyTarget, db: DatabaseSync): Promise<{ posts: DiscoveredReplyPost[]; requests: number } | { error: ThreadsApiError; requests: number }> {
  if (target.target_type === 'account') {
    const profile = await lookupThreadsProfile(target.value || '');
    if (!profile.ok) return { error: profile.error, requests: 1 };
    const posts = await fetchThreadsProfilePosts({ username: profile.data.username, limit: 25 });
    if (!posts.ok) return { error: posts.error, requests: 2 };
    return { posts: posts.data.map(post => asDiscovered(post, target, profile.data.username)), requests: 2 };
  }

  if (target.target_type === 'keyword' || target.target_type === 'topic') {
    const posts = await searchThreadsPosts({
      query: target.value || '',
      searchMode: target.target_type === 'topic' ? 'TAG' : 'KEYWORD',
      searchType: target.config.searchType || 'RECENT',
      limit: 25,
    });
    if (!posts.ok) return { error: posts.error, requests: 1 };
    return { posts: posts.data.map(post => asDiscovered(post, target, target.value || '')), requests: 1 };
  }

  if (target.target_type === 'community_bundle') return discoverBundle(target);
  return discoverFree(target, db);
}

async function discoverBundle(target: ReplyTarget): Promise<{ posts: DiscoveredReplyPost[]; requests: number } | { error: ThreadsApiError; requests: number }> {
  const posts: DiscoveredReplyPost[] = [];
  const config = target.config;
  let requests = 0;
  for (const username of config.accounts || []) {
    const profile = await lookupThreadsProfile(username);
    requests += 1;
    if (!profile.ok) return { error: profile.error, requests };
    const result = await fetchThreadsProfilePosts({ username: profile.data.username, limit: 25 });
    requests += 1;
    if (!result.ok) return { error: result.error, requests };
    posts.push(...result.data.map(post => asDiscovered(post, target, profile.data.username)));
  }
  for (const keyword of config.keywords || []) {
    const result = await searchThreadsPosts({ query: keyword, searchMode: 'KEYWORD', searchType: config.searchType || 'RECENT', limit: 25 });
    requests += 1;
    if (!result.ok) return { error: result.error, requests };
    posts.push(...result.data.map(post => asDiscovered(post, target, keyword)));
  }
  for (const topic of config.topics || []) {
    const result = await searchThreadsPosts({ query: topic, searchMode: 'TAG', searchType: config.searchType || 'RECENT', limit: 25 });
    requests += 1;
    if (!result.ok) return { error: result.error, requests };
    posts.push(...result.data.map(post => asDiscovered(post, target, topic)));
  }
  return { posts, requests };
}

async function discoverFree(target: ReplyTarget, db: DatabaseSync): Promise<{ posts: DiscoveredReplyPost[]; requests: number } | { error: ThreadsApiError; requests: number }> {
  const seeds = getFreeDiscoverySeeds(db).slice(0, 4);
  if (!seeds.length) return { error: { kind: 'api_error', error: 'Free discovery tidak punya seed dari content pillar aktif' }, requests: 0 };
  const posts: DiscoveredReplyPost[] = [];
  let requests = 0;
  for (const seed of seeds) {
    requests += 1;
    const result = await searchThreadsPosts({ query: seed, searchMode: 'KEYWORD', searchType: 'RECENT', limit: 25 });
    if (!result.ok) return { error: result.error, requests };
    posts.push(...result.data.map(post => asDiscovered(post, target, seed)));
  }
  return { posts, requests };
}

function asDiscovered(post: ThreadsPublicPost, target: ReplyTarget, query: string): DiscoveredReplyPost {
  return {
    post,
    targetId: target.id,
    targetType: target.target_type,
    targetLabel: target.label,
    query,
    selectionReason: `${target.label}: ${query}`,
    rootThreadId: post.id,
  };
}

type ContinuationSource = {
  target_id: number | null;
  target_thread_id: string;
  root_thread_id: string | null;
  target_username: string;
  target_type: ReplyTarget['target_type'];
  target_query: string | null;
  selection_reason: string | null;
  reply_thread_id: string;
  target_label: string;
};

async function discoverReplyContinuations(db: DatabaseSync): Promise<{ posts: DiscoveredReplyPost[]; requests: number; errors: DiscoveryResult['errors'] }> {
  // ponytail: scan the 50 most recent own replies; add cursor persistence only if this ceiling becomes constraining.
  const sources = db.prepare(`
    SELECT c.target_id, c.target_thread_id, c.root_thread_id, c.target_username, c.target_type, c.target_query,
      c.selection_reason, c.reply_thread_id, COALESCE(t.label, c.target_type) AS target_label
    FROM reply_candidates c
    LEFT JOIN reply_targets t ON t.id = c.target_id
    WHERE c.status = 'posted' AND c.reply_thread_id IS NOT NULL
    ORDER BY c.published_at DESC
    LIMIT 50
  `).all() as ContinuationSource[];
  const byRoot = new Map<string, ContinuationSource[]>();
  for (const source of sources) {
    const root = source.root_thread_id || source.target_thread_id;
    byRoot.set(root, [...(byRoot.get(root) || []), source]);
  }

  const posts: DiscoveredReplyPost[] = [];
  const errors: DiscoveryResult['errors'] = [];
  let requests = 0;
  for (const [rootThreadId, rootSources] of byRoot) {
    const conversation = await fetchThreadsConversation(rootThreadId);
    requests += 1;
    if (!conversation.ok) {
      const source = rootSources[0];
      errors.push({ targetId: source.target_id || 0, message: conversation.error.error, kind: conversation.error.kind });
      continue;
    }
    for (const source of rootSources) {
      for (const post of conversation.data) {
        if (!post.is_reply || post.is_reply_owned_by_me !== false || post.replied_to?.id !== source.reply_thread_id) continue;
        if (post.username?.trim().replace(/^@/, '').toLowerCase() !== source.target_username.trim().replace(/^@/, '').toLowerCase()) continue;
        posts.push({
          post,
          targetId: source.target_id,
          targetType: source.target_type,
          targetLabel: source.target_label,
          query: source.target_query || source.target_username,
          selectionReason: `${source.selection_reason || source.target_label}: continuation`,
          rootThreadId,
          parentReplyThreadId: source.reply_thread_id,
          isContinuation: true,
        });
      }
    }
  }
  return { posts, requests, errors };
}
