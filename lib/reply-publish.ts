import { getDb, getSetting, logAudit } from './db';
import { postReplyToThreads } from './threads-api';
import { classifyThreadsError, getReplyPublishingLimit } from './reply-api-capabilities';
import { getReplyCandidate, getReplyText } from './reply-candidates';
import { getReplyLimitSnapshot } from './reply-limits';

const PUBLISHING_STALE_MS = 30 * 60_000;

export type ReplyPublishResult =
  | { kind: 'disabled'; error: string }
  | { kind: 'posted'; id: string; url: string }
  | { kind: 'already_posted'; id: string | null; url: string | null }
  | { kind: 'publishing' }
  | { kind: 'not_publishable'; status: string }
  | { kind: 'not_found' }
  | { kind: 'failed'; error: string; retryable: boolean }
  | { kind: 'publish_unknown'; error: string; id?: string; url?: string };

export async function publishReplyCandidate(candidateId: number, auto = false): Promise<ReplyPublishResult> {
  const db = getDb();
  if (getSetting('kill_switch') === 'true') return { kind: 'disabled', error: 'Global kill switch aktif' };
  if (getSetting('reply_agent_enabled') !== 'true') return { kind: 'disabled', error: 'Reply Agent belum diaktifkan' };
  const candidate = getReplyCandidate(candidateId, db);
  if (!candidate) return { kind: 'not_found' };
  if (candidate.status === 'publish_unknown') return { kind: 'publish_unknown', error: 'Status publish tidak pasti; verifikasi manual diperlukan', id: candidate.reply_thread_id || undefined, url: candidate.reply_permalink || undefined };
  if (candidate.reply_thread_id || candidate.status === 'posted') return { kind: 'already_posted', id: candidate.reply_thread_id, url: candidate.reply_permalink };
  if (candidate.status === 'publishing') {
    if (isStalePublishing(candidate.publishing_started_at)) return markUnknown(candidateId, 'Stale publishing state requires manual verification');
    return { kind: 'publishing' };
  }
  const expectedStatus = auto ? 'queued' : 'approved';
  if (candidate.status !== expectedStatus) return { kind: 'not_publishable', status: candidate.status };
  if (candidate.quality_status !== 'passed' || !getReplyText(candidate)) return { kind: 'not_publishable', status: 'quality_failed' };
  if (auto && (getSetting('reply_posting_mode') !== 'auto' || getSetting('reply_auto_mode_approved') !== 'true')) return { kind: 'not_publishable', status: 'auto_mode_not_approved' };
  if (auto && (candidate.relevance_score || 0) < Number(getSetting('reply_auto_score_threshold') || '90')) return { kind: 'not_publishable', status: 'auto_score_below_threshold' };
  if (auto && candidate.risk_flags.length > 0) return { kind: 'not_publishable', status: 'risk_flags' };

  const quota = await getReplyPublishingLimit();
  if (!quota.ok) {
    logAudit('reply_quota_paused', `candidate=${candidateId} reason=${quota.error.error}`);
    return { kind: 'failed', error: `Official reply quota unavailable: ${quota.error.error}`, retryable: false };
  }
  const limits = getReplyLimitSnapshot(db, { targetUsername: candidate.target_username, parentReplyThreadId: candidate.parent_reply_thread_id }, quota.data);
  if (limits.effectiveRemaining <= 0) {
    logAudit('reply_quota_paused', `candidate=${candidateId} reason=${limits.reason || 'no_remaining_capacity'} official_remaining=${quota.data.remaining}`);
    return { kind: 'failed', error: limits.reason || 'Reply limit tercapai atau di luar active window', retryable: false };
  }

  const claimed = db.prepare(`
    UPDATE reply_candidates
    SET status = 'publishing', publishing_started_at = ?, updated_at = ?, last_error = NULL
    WHERE id = ? AND status = ? AND reply_thread_id IS NULL
  `).run(Date.now(), Date.now(), candidateId, expectedStatus);
  if (claimed.changes !== 1) {
    const current = getReplyCandidate(candidateId, db);
    if (!current) return { kind: 'not_found' };
    if (current.status === 'publish_unknown') return { kind: 'publish_unknown', error: 'Status publish tidak pasti; verifikasi manual diperlukan', id: current.reply_thread_id || undefined, url: current.reply_permalink || undefined };
    if (current.reply_thread_id || current.status === 'posted') return { kind: 'already_posted', id: current.reply_thread_id, url: current.reply_permalink };
    if (current.status === 'publishing') {
      if (isStalePublishing(current.publishing_started_at)) return markUnknown(candidateId, 'Stale publishing state requires manual verification');
      return { kind: 'publishing' };
    }
    return { kind: 'not_publishable', status: current.status };
  }
  const postClaimLimits = getReplyLimitSnapshot(db, { targetUsername: candidate.target_username, parentReplyThreadId: candidate.parent_reply_thread_id }, quota.data, Date.now(), candidateId);
  if (postClaimLimits.effectiveRemaining <= 0) {
    const reason = postClaimLimits.reason || 'reply_capacity_race';
    db.prepare("UPDATE reply_candidates SET status = ?, publishing_started_at = NULL, last_error = ?, updated_at = ? WHERE id = ? AND status = 'publishing'").run(expectedStatus, reason, Date.now(), candidateId);
    logAudit('reply_publish_deferred', `candidate=${candidateId} reason=${reason}`);
    return { kind: 'failed', error: reason, retryable: true };
  }
  logAudit('reply_publish_claimed', `candidate=${candidateId} target=${candidate.target_thread_id}`);

  const result = await postReplyToThreads(getReplyText(candidate), candidate.target_thread_id);
  if ('error' in result) {
    const classified = classifyThreadsError(result.status, result.error, result.error);
    if (result.ambiguous) return markUnknown(candidateId, result.error, result.id, result.url);
    if (classified.kind === 'target_restricted' || classified.kind === 'target_deleted') return markSkipped(candidateId, result.error);
    return markFailed(candidateId, result.error, result.safeToRetry);
  }
  db.prepare(`
    UPDATE reply_candidates SET status = 'posted', reply_thread_id = ?, reply_permalink = ?, published_at = ?, updated_at = ?, last_error = NULL
    WHERE id = ? AND status = 'publishing'
  `).run(result.id, result.url, Date.now(), candidateId);
  logAudit('reply_posted', `candidate=${candidateId} reply=${result.id} verified=${result.verified}`);
  return { kind: 'posted', id: result.id, url: result.url };
}

function isStalePublishing(startedAt: number | null): boolean {
  return Boolean(startedAt && Date.now() - startedAt > PUBLISHING_STALE_MS);
}

function markSkipped(candidateId: number, error: string): ReplyPublishResult {
  getDb().prepare("UPDATE reply_candidates SET status = 'skipped', last_error = ?, updated_at = ? WHERE id = ? AND status = 'publishing'").run(error.slice(0, 500), Date.now(), candidateId);
  logAudit('reply_publish_failed', `candidate=${candidateId} skipped=${error.slice(0, 120)}`);
  return { kind: 'failed', error, retryable: false };
}

function markFailed(candidateId: number, error: string, retryable: boolean): ReplyPublishResult {
  getDb().prepare("UPDATE reply_candidates SET status = 'failed', retry_count = retry_count + 1, last_error = ?, updated_at = ? WHERE id = ? AND status = 'publishing'").run(error.slice(0, 500), Date.now(), candidateId);
  logAudit('reply_publish_failed', `candidate=${candidateId} retryable=${retryable} error=${error.slice(0, 120)}`);
  return { kind: 'failed', error, retryable };
}

function markUnknown(candidateId: number, error: string, replyId?: string, replyUrl?: string): ReplyPublishResult {
  getDb().prepare("UPDATE reply_candidates SET status = 'publish_unknown', reply_thread_id = COALESCE(?, reply_thread_id), reply_permalink = COALESCE(?, reply_permalink), last_error = ?, updated_at = ? WHERE id = ? AND status = 'publishing'").run(replyId || null, replyUrl || null, error.slice(0, 500), Date.now(), candidateId);
  logAudit('reply_publish_unknown', `candidate=${candidateId} error=${error.slice(0, 120)}`);
  return { kind: 'publish_unknown', error, id: replyId, url: replyUrl };
}
