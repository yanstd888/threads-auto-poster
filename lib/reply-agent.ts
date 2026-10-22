import { getDb, getSetting, logAudit, setSetting } from './db';
import { invokeHermesReply } from './hermes';
import { runReplyQualityGate } from './reply-quality';
import { discoverReplyPosts } from './reply-discovery';
import {
  expireStaleReplyCandidates,
  getReplyCandidate,
  getReplyText,
  listReplyCandidates,
  upsertDiscoveredReplyCandidate,
  type ReplyCandidate,
} from './reply-candidates';
import { isReplyActiveWindow } from './reply-limits';
import { publishReplyCandidate } from './reply-publish';

export async function runReplyDiscoveryCycle(): Promise<{ discovered: number; inserted: number; skipped: number; errors: number } | { error: string }> {
  if (getSetting('reply_agent_enabled') !== 'true') return { error: 'Reply Agent belum diaktifkan' };
  if (getSetting('kill_switch') === 'true') return { error: 'Global kill switch aktif' };
  const db = getDb();
  logAudit('reply_discovery_started', 'bounded cycle');
  const result = await discoverReplyPosts(db);
  if ('error' in result) return result;
  let inserted = 0;
  let skipped = 0;
  for (const discovered of result.discovered) {
    const candidate = upsertDiscoveredReplyCandidate(discovered, db);
    if (candidate.inserted) inserted += 1;
    if (candidate.skipped) skipped += 1;
  }
  const expired = expireStaleReplyCandidates(db);
  setSetting('reply_last_discovery_at', String(Date.now()));
  logAudit('reply_discovery_completed', `discovered=${result.discovered.length} inserted=${inserted} skipped=${skipped} expired=${expired} errors=${result.errors.length}`);
  return { discovered: result.discovered.length, inserted, skipped, errors: result.errors.length };
}

export async function generateReplyCandidate(candidateId: number): Promise<{ candidate: ReplyCandidate } | { error: string }> {
  const db = getDb();
  let candidate = getReplyCandidate(candidateId, db);
  if (!candidate) return { error: 'Candidate tidak ditemukan' };
  if (!['discovered', 'scored', 'quality_failed', 'failed'].includes(candidate.status)) return { error: `Candidate tidak dapat digenerate dari status ${candidate.status}` };
  const claimed = db.prepare("UPDATE reply_candidates SET status = 'drafting', updated_at = ?, last_error = NULL WHERE id = ? AND status IN ('discovered', 'scored', 'quality_failed', 'failed')").run(Date.now(), candidateId);
  if (claimed.changes !== 1) return { error: 'Candidate sedang diproses oleh worker lain' };
  candidate = getReplyCandidate(candidateId, db);
  if (!candidate) return { error: 'Candidate tidak ditemukan setelah claim' };
  logAudit('reply_generation_started', `candidate=${candidateId}`);
  const language = candidate.reply_language === 'en' ? 'en' : 'id';
  const recent = db.prepare(`
    SELECT COALESCE(edited_reply, generated_reply) AS reply FROM reply_candidates
    WHERE status IN ('draft', 'approved', 'posted') AND COALESCE(edited_reply, generated_reply) IS NOT NULL
    ORDER BY published_at DESC LIMIT 10
  `).all() as Array<{ reply: string | null }>;
  let response: Awaited<ReturnType<typeof invokeHermesReply>>;
  try {
    response = await invokeHermesReply({
      targetText: candidate.target_text,
      targetUsername: candidate.target_username,
      targetTopicTag: candidate.target_topic_tag,
      targetAgeMinutes: candidate.target_posted_at ? Math.max(0, Math.round((Date.now() - candidate.target_posted_at) / 60_000)) : null,
      language,
      selectionReason: candidate.selection_reason || '',
      recentReplies: recent.map(item => item.reply || '').filter(Boolean),
      riskFlags: candidate.risk_flags,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Hermes reply generation failed';
    db.prepare("UPDATE reply_candidates SET status = 'failed', retry_count = retry_count + 1, last_error = ?, quality_status = 'failed', quality_reasons = ?, updated_at = ? WHERE id = ? AND status = 'drafting'")
      .run(message, JSON.stringify([message]), Date.now(), candidateId);
    logAudit('reply_generation_failed', `candidate=${candidateId} error=${message.slice(0, 120)}`);
    return { error: message };
  }
  if (response.error) {
    db.prepare("UPDATE reply_candidates SET status = 'failed', retry_count = retry_count + 1, last_error = ?, quality_status = 'failed', quality_reasons = ?, updated_at = ? WHERE id = ? AND status = 'drafting'")
      .run(response.error, JSON.stringify([response.error]), Date.now(), candidateId);
    logAudit('reply_generation_failed', `candidate=${candidateId} error=${response.error.slice(0, 120)}`);
    return { error: response.error };
  }
  const quality = runReplyQualityGate({
    replyText: response.replyText,
    targetText: candidate.target_text,
    targetLanguage: language,
    recentReplies: recent.map(item => item.reply || '').filter(Boolean),
    blockedRiskFlags: candidate.risk_flags,
  });
  const status = quality.passed ? 'draft' : 'quality_failed';
  db.prepare(`
    UPDATE reply_candidates
    SET status = ?, generated_reply = ?, edited_reply = NULL, reply_language = ?, reply_mechanism = ?, reply_reason = ?,
        quality_score = ?, quality_status = ?, quality_reasons = ?, last_error = ?, updated_at = ?
    WHERE id = ? AND status = 'drafting'
  `).run(status, response.replyText, response.language, response.mechanism, response.reason, quality.score, quality.passed ? 'passed' : 'failed', JSON.stringify(quality.reasons), quality.passed ? null : 'quality_reject', Date.now(), candidateId);
  if (!quality.passed) {
    logAudit('reply_quality_failed', `candidate=${candidateId} reasons=${quality.reasons.join('|')}`);
    return { error: `quality_reject: ${quality.reasons.join('; ')}` };
  }
  const updated = getReplyCandidate(candidateId, db)!;
  logAudit('reply_candidate_drafted', `candidate=${candidateId} score=${quality.score}`);
  return { candidate: updated };
}

export function editReplyCandidate(candidateId: number, replyText: string): { candidate: ReplyCandidate } | { error: string } {
  const db = getDb();
  const candidate = getReplyCandidate(candidateId, db);
  if (!candidate) return { error: 'Candidate tidak ditemukan' };
  if (!['draft', 'quality_failed'].includes(candidate.status)) return { error: `Candidate tidak dapat diedit dari status ${candidate.status}` };
  const text = String(replyText || '').trim();
  const quality = runReplyQualityGate({ replyText: text, targetText: candidate.target_text, targetLanguage: candidate.reply_language === 'en' ? 'en' : 'id', recentReplies: [], blockedRiskFlags: candidate.risk_flags });
  db.prepare(`
    UPDATE reply_candidates SET edited_reply = ?, quality_score = ?, quality_status = ?, quality_reasons = ?,
      status = ?, last_error = ?, updated_at = ? WHERE id = ?
  `).run(text, quality.score, quality.passed ? 'passed' : 'failed', JSON.stringify(quality.reasons), quality.passed ? 'draft' : 'quality_failed', quality.passed ? null : 'quality_reject', Date.now(), candidateId);
  return quality.passed ? { candidate: getReplyCandidate(candidateId, db)! } : { error: `quality_reject: ${quality.reasons.join('; ')}` };
}

export function approveReplyCandidate(candidateId: number): { candidate: ReplyCandidate } | { error: string } {
  const db = getDb();
  const candidate = getReplyCandidate(candidateId, db);
  if (!candidate) return { error: 'Candidate tidak ditemukan' };
  if (candidate.status !== 'draft' || candidate.quality_status !== 'passed' || !getReplyText(candidate)) return { error: 'Candidate harus berupa draft lulus quality gate' };
  db.prepare("UPDATE reply_candidates SET status = 'approved', reviewed_at = ?, updated_at = ?, last_error = NULL WHERE id = ? AND status = 'draft'").run(Date.now(), Date.now(), candidateId);
  logAudit('reply_approved', `candidate=${candidateId}`);
  return { candidate: getReplyCandidate(candidateId, db)! };
}

export function rejectReplyCandidate(candidateId: number, reason = 'operator_rejected'): { candidate: ReplyCandidate } | { error: string } {
  const db = getDb();
  const candidate = getReplyCandidate(candidateId, db);
  if (!candidate) return { error: 'Candidate tidak ditemukan' };
  if (['posted', 'publishing', 'publish_unknown'].includes(candidate.status)) return { error: 'Candidate sudah masuk alur publish' };
  db.prepare("UPDATE reply_candidates SET status = 'rejected', reviewed_at = ?, last_error = ?, updated_at = ? WHERE id = ?").run(Date.now(), reason.slice(0, 500), Date.now(), candidateId);
  logAudit('reply_rejected', `candidate=${candidateId} reason=${reason.slice(0, 120)}`);
  return { candidate: getReplyCandidate(candidateId, db)! };
}

export function retryReplyCandidate(candidateId: number): { candidate: ReplyCandidate } | { error: string } {
  const db = getDb();
  const candidate = getReplyCandidate(candidateId, db);
  if (!candidate) return { error: 'Candidate tidak ditemukan' };
  if (['posted', 'publishing', 'publish_unknown', 'rejected'].includes(candidate.status)) return { error: 'Candidate tidak dapat di-retry dari status ini' };
  db.prepare(`
    UPDATE reply_candidates SET status = 'discovered', generated_reply = NULL, edited_reply = NULL, reply_mechanism = NULL,
      reply_reason = NULL, quality_score = NULL, quality_status = NULL, quality_reasons = '[]', last_error = NULL,
      retry_count = retry_count + 1, updated_at = ? WHERE id = ?
  `).run(Date.now(), candidateId);
  return { candidate: getReplyCandidate(candidateId, db)! };
}

export async function runReplyAgentCycle(): Promise<void> {
  try {
    if (getSetting('reply_agent_enabled') !== 'true' || getSetting('kill_switch') === 'true') return;
    if (!isReplyActiveWindow()) return;
    const interval = Number(getSetting('reply_discovery_interval_minutes') || '15') * 60_000;
    const last = Number(getSetting('reply_last_discovery_at') || '0');
    if (last && Date.now() - last < interval) return;
    const discovery = await runReplyDiscoveryCycle();
    if ('error' in discovery) return;
    const candidates = listReplyCandidates(getDb(), 'scored', 3);
    for (const candidate of candidates) {
      const generated = await generateReplyCandidate(candidate.id);
      if ('error' in generated || getSetting('reply_posting_mode') !== 'auto' || getSetting('reply_auto_mode_approved') !== 'true') continue;
      const queued = getDb().prepare("UPDATE reply_candidates SET status = 'queued', scheduled_at = ?, updated_at = ? WHERE id = ? AND status = 'draft' AND quality_status = 'passed'").run(Date.now(), Date.now(), candidate.id);
      if (queued.changes !== 1) continue;
      await publishReplyCandidate(candidate.id, true);
    }
  } catch (error: unknown) {
    logAudit('reply_agent_cycle_failed', error instanceof Error ? error.message.slice(0, 500) : 'Reply Agent cycle failed');
  }
}

export function getReplyAgentStatus() {
  const db = getDb();
  const counts = db.prepare('SELECT status, COUNT(*) AS count FROM reply_candidates GROUP BY status').all() as Array<{ status: string; count: number }>;
  return {
    enabled: getSetting('reply_agent_enabled') === 'true',
    postingMode: getSetting('reply_posting_mode') || 'approval',
    autoModeApproved: getSetting('reply_auto_mode_approved') === 'true',
    lastDiscoveryAt: Number(getSetting('reply_last_discovery_at') || '0') || null,
    counts: Object.fromEntries(counts.map(row => [row.status, Number(row.count)])),
  };
}
