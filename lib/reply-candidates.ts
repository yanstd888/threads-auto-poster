import type { DatabaseSync } from 'node:sqlite';
import { getDb, getSetting, logAudit } from './db';
import { ACCOUNT_POSITIONING } from './brand-links';
import type { DiscoveredReplyPost } from './reply-discovery';
import { getReplyAccountPolicyDecision } from './reply-limits';
import { getReplyTarget, type ReplyTarget } from './reply-targets';

export type ReplyCandidateStatus = 'discovered' | 'drafting' | 'draft' | 'quality_failed' | 'approved' | 'queued' | 'publishing' | 'posted' | 'rejected' | 'skipped' | 'expired' | 'failed' | 'publish_unknown';

export interface ReplyCandidate {
  id: number;
  target_id: number | null;
  target_thread_id: string;
  root_thread_id: string | null;
  parent_reply_thread_id: string | null;
  target_username: string;
  target_permalink: string | null;
  target_text: string;
  target_topic_tag: string | null;
  target_posted_at: number | null;
  target_type: string;
  target_query: string | null;
  discovered_at: number;
  relevance_score: number | null;
  selection_reason: string | null;
  risk_flags: string[];
  generated_reply: string | null;
  edited_reply: string | null;
  reply_language: string | null;
  reply_mechanism: string | null;
  reply_reason: string | null;
  quality_score: number | null;
  quality_status: string | null;
  quality_reasons: string[];
  status: ReplyCandidateStatus;
  reviewed_at: number | null;
  scheduled_at: number | null;
  publishing_started_at: number | null;
  reply_thread_id: string | null;
  reply_permalink: string | null;
  published_at: number | null;
  last_error: string | null;
  retry_count: number;
  created_at: number;
  updated_at: number;
}

export interface CandidateUpsertResult {
  inserted: boolean;
  candidate: ReplyCandidate;
  skipped: boolean;
}

const POSITIONING_TERMS = new Set('umkm usaha bisnis builder developer coding website web ai automation otomasi agent workflow landing page seo toko tim'.split(' '));
const STOP_WORDS = new Set('yang dan untuk dengan dari pada ini itu di ke adalah sebagai bisa agar atau juga dalam karena buat bagi sudah akan tidak lebih jika kamu kami saya the and for with from this that are is to of a in on your you'.split(' '));
const LINK_PATTERN = /https?:\/\/[^\s]+/i;
const GIVEAWAY_PATTERN = /\b(?:giveaway|free money|hadiah|undian|casino|judi|porn|nsfw)\b/i;
const PROMPT_INJECTION_PATTERN = /\b(?:ignore|abaikan|lupakan)\b.{0,32}\b(?:instruction|instruksi|aturan|prompt)\b/i;

export function upsertDiscoveredReplyCandidate(discovered: DiscoveredReplyPost, db: DatabaseSync = getDb(), now = Date.now()): CandidateUpsertResult {
  const target = discovered.targetId ? getReplyTarget(discovered.targetId, db) : null;
  const evaluation = evaluateReplyPost(discovered, target, now);
  const accountPolicy = getReplyAccountPolicyDecision(db, {
    targetUsername: discovered.post.username || '',
    parentReplyThreadId: discovered.parentReplyThreadId,
  });
  const skipped = evaluation.skipped || !accountPolicy.allowed;
  const skipReason = evaluation.skipReason || accountPolicy.reason || null;
  const selectionReason = accountPolicy.allowed || !accountPolicy.reason
    ? evaluation.reason
    : `${evaluation.reason}; ${accountPolicy.reason}`;
  const insert = db.prepare(`
    INSERT INTO reply_candidates (
      target_id, target_thread_id, root_thread_id, parent_reply_thread_id, target_username, target_permalink, target_text, target_topic_tag,
      target_posted_at, target_type, target_query, discovered_at, relevance_score, selection_reason,
      risk_flags, reply_language, status, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(target_thread_id) DO NOTHING
  `);
  const result = insert.run(
    discovered.targetId,
    discovered.post.id,
    discovered.rootThreadId || discovered.post.id,
    discovered.parentReplyThreadId || null,
    discovered.post.username || '',
    discovered.post.permalink || null,
    discovered.post.text,
    discovered.post.topic_tag || null,
    parseTimestamp(discovered.post.timestamp),
    discovered.targetType,
    discovered.query,
    now,
    evaluation.score,
    selectionReason,
    JSON.stringify(evaluation.riskFlags),
    evaluation.language,
    skipped ? 'skipped' : 'scored',
    skipReason,
    now,
    now,
  );
  const candidate = getReplyCandidateByThreadId(discovered.post.id, db)!;
  if (result.changes === 1) logAudit(skipped ? 'reply_candidate_skipped' : 'reply_candidate_created', `candidate=${candidate.id} score=${evaluation.score}`, db);
  return { inserted: result.changes === 1, candidate, skipped };
}

export function getReplyCandidate(id: number, db: DatabaseSync = getDb()): ReplyCandidate | null {
  const row = db.prepare('SELECT * FROM reply_candidates WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? toReplyCandidate(row) : null;
}

export function getReplyCandidateByThreadId(threadId: string, db: DatabaseSync = getDb()): ReplyCandidate | null {
  const row = db.prepare('SELECT * FROM reply_candidates WHERE target_thread_id = ?').get(threadId) as Record<string, unknown> | undefined;
  return row ? toReplyCandidate(row) : null;
}

export function listReplyCandidates(db: DatabaseSync = getDb(), status?: string, limit = 50): ReplyCandidate[] {
  const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)));
  const rows = status
    ? db.prepare('SELECT * FROM reply_candidates WHERE status = ? ORDER BY discovered_at DESC LIMIT ?').all(status, safeLimit)
    : db.prepare('SELECT * FROM reply_candidates ORDER BY discovered_at DESC LIMIT ?').all(safeLimit);
  return (rows as Array<Record<string, unknown>>).map(toReplyCandidate);
}

export function getReplyText(candidate: ReplyCandidate): string {
  return (candidate.edited_reply || candidate.generated_reply || '').trim();
}

export function evaluateReplyPost(discovered: DiscoveredReplyPost, target: ReplyTarget | null, now = Date.now()): { score: number; reason: string; riskFlags: string[]; skipped: boolean; skipReason: string | null; language: 'id' | 'en' } {
  const post = discovered.post;
  const reasons: string[] = [];
  const blockers: string[] = [];
  const riskFlags: string[] = [];
  const username = post.username?.trim().toLowerCase() || '';
  const ownUsername = getSetting('threads_username')?.trim().toLowerCase().replace(/^@/, '');
  const maxAgeHours = Number(getSetting('reply_max_post_age_hours') || '48');
  const postedAt = parseTimestamp(post.timestamp);
  const language = detectReplyLanguage(post.text);
  const configuredLanguage = target?.config.language || getSetting('reply_language_mode') || 'match_target';
  const queryTerms = tokenize([discovered.query, ...(target?.config.includeTerms || [])].join(' '));
  const postTerms = tokenize(post.text);
  const positioningTerms = tokenize(ACCOUNT_POSITIONING).filter(term => POSITIONING_TERMS.has(term));
  const matchedQuery = queryTerms.filter(term => postTerms.includes(term));
  const matchedPositioning = positioningTerms.filter(term => postTerms.includes(term));
  const excludeTerms = tokenize((target?.config.excludeTerms || []).join(' '));
  const blockedExclude = excludeTerms.find(term => postTerms.includes(term));

  if (!username) blockers.push('missing_target_username');
  if (ownUsername && username === ownUsername) blockers.push('own_account');
  if (post.is_reply && !discovered.isContinuation) blockers.push('nested_reply');
  if (discovered.isContinuation && (!discovered.parentReplyThreadId || post.replied_to?.id !== discovered.parentReplyThreadId)) blockers.push('continuation_parent_mismatch');
  if (post.reply_audience && post.reply_audience.toLowerCase() !== 'everyone') blockers.push('reply_control');
  if (postedAt && now - postedAt > maxAgeHours * 60 * 60_000) blockers.push('post_too_old');
  if (LINK_PATTERN.test(post.text) && post.text.replace(LINK_PATTERN, '').replace(/\s+/g, '').length < 24) blockers.push('link_only');
  if (GIVEAWAY_PATTERN.test(post.text)) blockers.push('blocked_category');
  if (blockedExclude) blockers.push(`excluded_term:${blockedExclude}`);
  if (configuredLanguage !== 'match_target' && configuredLanguage !== language) blockers.push('language_mismatch');
  if (PROMPT_INJECTION_PATTERN.test(post.text)) riskFlags.push('prompt_injection_text');
  if (GIVEAWAY_PATTERN.test(post.text)) riskFlags.push('sensitive_category');
  if (matchedQuery.length === 0 && matchedPositioning.length === 0) blockers.push('unrelated_to_positioning');

  const recencyScore = postedAt ? Math.max(0, Math.min(25, Math.round(25 - (now - postedAt) / (maxAgeHours * 60 * 60_000) * 25))) : 5;
  const queryScore = queryTerms.length ? Math.min(45, matchedQuery.length * 18) : 0;
  const contextScore = Math.min(35, matchedPositioning.length * 12);
  const substanceScore = post.text.length >= 80 ? 15 : post.text.length >= 40 ? 10 : 3;
  const score = Math.max(0, Math.min(100, recencyScore + queryScore + contextScore + substanceScore));
  if (matchedQuery.length) reasons.push(`query_match:${matchedQuery.slice(0, 4).join(',')}`);
  if (matchedPositioning.length) reasons.push(`positioning_match:${matchedPositioning.slice(0, 4).join(',')}`);
  if (postedAt) reasons.push(`age_minutes:${Math.max(0, Math.round((now - postedAt) / 60_000))}`);

  const threshold = Number(getSetting('reply_relevance_threshold') || '80');
  const skipped = blockers.length > 0 || score < threshold;
  const skipReason = blockers.length ? blockers.join('; ') : score < threshold ? `relevance_below_threshold:${threshold}` : null;
  return { score, reason: [...blockers, ...reasons].join('; ') || `score=${score}`, riskFlags, skipped, skipReason, language };
}

export function expireStaleReplyCandidates(db: DatabaseSync = getDb(), now = Date.now()): number {
  const ageHours = Number(getSetting('reply_max_post_age_hours') || '48');
  const cutoff = now - ageHours * 60 * 60_000;
  return Number(db.prepare(`
    UPDATE reply_candidates SET status = 'expired', last_error = 'target_post_expired', updated_at = ?
    WHERE status IN ('discovered', 'scored', 'draft', 'approved', 'queued')
      AND target_posted_at IS NOT NULL AND target_posted_at < ?
  `).run(now, cutoff).changes);
}

function toReplyCandidate(row: Record<string, unknown>): ReplyCandidate {
  return {
    id: Number(row.id),
    target_id: row.target_id == null ? null : Number(row.target_id),
    target_thread_id: String(row.target_thread_id),
    root_thread_id: row.root_thread_id == null ? null : String(row.root_thread_id),
    parent_reply_thread_id: row.parent_reply_thread_id == null ? null : String(row.parent_reply_thread_id),
    target_username: String(row.target_username),
    target_permalink: row.target_permalink == null ? null : String(row.target_permalink),
    target_text: String(row.target_text),
    target_topic_tag: row.target_topic_tag == null ? null : String(row.target_topic_tag),
    target_posted_at: row.target_posted_at == null ? null : Number(row.target_posted_at),
    target_type: String(row.target_type),
    target_query: row.target_query == null ? null : String(row.target_query),
    discovered_at: Number(row.discovered_at),
    relevance_score: row.relevance_score == null ? null : Number(row.relevance_score),
    selection_reason: row.selection_reason == null ? null : String(row.selection_reason),
    risk_flags: parseStringArray(row.risk_flags),
    generated_reply: row.generated_reply == null ? null : String(row.generated_reply),
    edited_reply: row.edited_reply == null ? null : String(row.edited_reply),
    reply_language: row.reply_language == null ? null : String(row.reply_language),
    reply_mechanism: row.reply_mechanism == null ? null : String(row.reply_mechanism),
    reply_reason: row.reply_reason == null ? null : String(row.reply_reason),
    quality_score: row.quality_score == null ? null : Number(row.quality_score),
    quality_status: row.quality_status == null ? null : String(row.quality_status),
    quality_reasons: parseStringArray(row.quality_reasons),
    status: String(row.status) as ReplyCandidateStatus,
    reviewed_at: row.reviewed_at == null ? null : Number(row.reviewed_at),
    scheduled_at: row.scheduled_at == null ? null : Number(row.scheduled_at),
    publishing_started_at: row.publishing_started_at == null ? null : Number(row.publishing_started_at),
    reply_thread_id: row.reply_thread_id == null ? null : String(row.reply_thread_id),
    reply_permalink: row.reply_permalink == null ? null : String(row.reply_permalink),
    published_at: row.published_at == null ? null : Number(row.published_at),
    last_error: row.last_error == null ? null : String(row.last_error),
    retry_count: Number(row.retry_count || 0),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  };
}

function parseStringArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseTimestamp(value?: string): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function detectReplyLanguage(text: string): 'id' | 'en' {
  const indonesian = (text.match(/\b(?:yang|dan|untuk|dengan|kalau|bisa|sudah|belum|karena|pakai|lebih|usaha|kamu|saya)\b/giu) || []).length;
  const english = (text.match(/\b(?:the|and|for|with|when|can|have|because|use|more|your|you|business|workflow)\b/giu) || []).length;
  return indonesian >= english ? 'id' : 'en';
}

function tokenize(value: string): string[] {
  return [...new Set((value.toLocaleLowerCase('id-ID').match(/[\p{L}\p{N}]{2,}/gu) || []).filter(token => !STOP_WORDS.has(token)))];
}
