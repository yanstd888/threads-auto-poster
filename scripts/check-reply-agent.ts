import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'threads-reply-agent-'));
process.env.THREADS_DATA_DIR = root;
let closeDb: (() => void) | null = null;

async function main() {
  try {
    const { getDb, getSetting, initDB, setSetting } = await import('../lib/db');
    const { addReplyTarget, getReplyTarget } = await import('../lib/reply-targets');
    const { evaluateReplyPost, upsertDiscoveredReplyCandidate, getReplyCandidate } = await import('../lib/reply-candidates');
    const { runReplyQualityGate } = await import('../lib/reply-quality');
    const { getReplyLimitSnapshot } = await import('../lib/reply-limits');
    const { validateSettingValue } = await import('../lib/settings-validation');
    const { classifyThreadsError, createReplyContainerUrl } = await import('../lib/reply-api-capabilities');
    const { buildAuthorizeUrl } = await import('../lib/threads-oauth');
    const { captureReplySnapshots } = await import('../lib/reply-analytics');
    const { publishReplyCandidate } = await import('../lib/reply-publish');
    const { disconnectThreads, getToken, postReplyToThreads, saveToken } = await import('../lib/threads-api');

  initDB();
  const db = getDb();
  closeDb = () => db.close();
  const replyColumns = db.prepare('PRAGMA table_info(reply_candidates)').all() as Array<{ name: string }>;
  assert.ok(replyColumns.some(column => column.name === 'root_thread_id'));
  assert.ok(replyColumns.some(column => column.name === 'parent_reply_thread_id'));
  assert.equal(getSetting('reply_account_policy'), 'once');
  assert.equal(validateSettingValue('reply_account_policy', 'continuations_only'), 'continuations_only');
  assert.ok(validateSettingValue('reply_account_policy', 'always') instanceof Error);
  setSetting('timezone', 'UTC');
  setSetting('reply_active_hours_start', '0');
  setSetting('reply_active_hours_end', '23');
  setSetting('reply_active_days', '[0,1,2,3,4,5,6]');
  setSetting('reply_relevance_threshold', '80');
  const originalAppId = process.env.THREADS_APP_ID;
  const originalAppSecret = process.env.THREADS_APP_SECRET;
  const originalTokenEncryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.THREADS_APP_ID = 'reply-agent-check-app';
  process.env.THREADS_APP_SECRET = 'reply-agent-check-secret';
  process.env.TOKEN_ENCRYPTION_KEY = '12345678901234567890123456789012';
  const baseOAuth = new URL(buildAuthorizeUrl('state', {})!);
  const replyOAuth = new URL(buildAuthorizeUrl('state', { includeReplyDiscovery: true })!);
  assert.equal(baseOAuth.searchParams.get('scope'), 'threads_basic,threads_content_publish,threads_manage_insights,threads_manage_replies');
  assert.match(replyOAuth.searchParams.get('scope') || '', /threads_keyword_search/);
  assert.match(replyOAuth.searchParams.get('scope') || '', /threads_profile_discovery/);
  assert.match(replyOAuth.searchParams.get('scope') || '', /threads_read_replies/);
  saveToken('threads', 'check-token');
  disconnectThreads();
  assert.ok('error' in getToken('threads'));
  if (originalAppId === undefined) delete process.env.THREADS_APP_ID; else process.env.THREADS_APP_ID = originalAppId;
  if (originalAppSecret === undefined) delete process.env.THREADS_APP_SECRET; else process.env.THREADS_APP_SECRET = originalAppSecret;
  if (originalTokenEncryptionKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY; else process.env.TOKEN_ENCRYPTION_KEY = originalTokenEncryptionKey;

  const targetResult = addReplyTarget({
    target_type: 'keyword',
    label: 'Website untuk UMKM',
    value: 'website',
    config: { language: 'id' },
    weight: 3,
  }, db);
  assert.ok(!('error' in targetResult));
  const target = getReplyTarget(targetResult.id, db);
  assert.ok(target);

  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const discovered = {
    targetId: target.id,
    targetType: 'keyword' as const,
    targetLabel: target.label,
    query: 'website',
    selectionReason: 'keyword match',
    post: {
      id: 'post-1',
      username: 'builder_id',
      text: 'Saya sedang membangun website untuk UMKM agar alur kerja dan otomasi lebih mudah diukur.',
      timestamp: new Date(now - 30 * 60_000).toISOString(),
      permalink: 'https://threads.net/@builder_id/post-1',
    },
  };
  const evaluation = evaluateReplyPost(discovered, target, now);
  assert.equal(evaluation.skipped, false);
  assert.ok(evaluation.score >= 80);

  const unrelated = evaluateReplyPost({ ...discovered, post: { ...discovered.post, id: 'post-2', text: 'Cuaca hari ini cerah dan jalanan ramai.' } }, target, now);
  assert.equal(unrelated.skipped, true);
  const openReplyAudience = evaluateReplyPost({ ...discovered, post: { ...discovered.post, id: 'post-open-audience', reply_audience: 'EVERYONE' } }, target, now);
  assert.equal(openReplyAudience.skipped, false);

  const goodReply = runReplyQualityGate({
    replyText: 'Untuk UMKM, mulai dari satu alur kerja yang paling sering berulang, ukur waktunya, lalu otomasi bagian yang stabil sebelum menambah integrasi AI.',
    targetText: discovered.post.text,
    targetLanguage: 'id',
  });
  assert.equal(goodReply.passed, true);
  const unsafeReply = runReplyQualityGate({ replyText: 'Cek website saya di https://example.com untuk promo.', targetText: discovered.post.text, targetLanguage: 'id' });
  assert.equal(unsafeReply.passed, false);
  assert.ok(unsafeReply.reasons.includes('url_not_allowed'));

  const limits = getReplyLimitSnapshot(db, { targetUsername: 'builder_id' }, { quotaUsage: 1, quotaTotal: 5, quotaDuration: 86400, remaining: 4 }, now);
  assert.equal(limits.active, true);
  assert.equal(limits.effectiveRemaining, 4);
  const exhausted = getReplyLimitSnapshot(db, { targetUsername: 'builder_id' }, { quotaUsage: 5, quotaTotal: 5, quotaDuration: 86400, remaining: 0 }, now);
  assert.equal(exhausted.effectiveRemaining, 0);

  const container = createReplyContainerUrl('user-1', 'token-not-printed', 'Reply yang sudah lolos quality gate', 'post-1');
  assert.equal(container.searchParams.get('reply_to_id'), 'post-1');
  assert.equal(container.searchParams.get('media_type'), 'TEXT');
  assert.throws(() => createReplyContainerUrl('user-1', 'token-not-printed', 'Reply', '   '), /reply_to_id wajib/);
  const missingTarget = await postReplyToThreads('Reply', '   ');
  if (!('error' in missingTarget)) throw new Error('empty reply target must fail before publishing');
  assert.equal(missingTarget.ambiguous, false);
  assert.equal(missingTarget.safeToRetry, false);
  assert.equal(classifyThreadsError(403, { error: { message: 'Reply control restricted' } }).kind, 'target_restricted');
  assert.equal(classifyThreadsError(500, {}).kind, 'discovery_transient');

  const candidateResult = upsertDiscoveredReplyCandidate(discovered, db, now);
  assert.equal(candidateResult.inserted, true);
  const candidateId = candidateResult.candidate.id;
  db.prepare("UPDATE reply_candidates SET status = 'approved', generated_reply = ?, quality_status = 'passed' WHERE id = ?").run('Reply yang lolos gate dan menambah detail implementasi.', candidateId);
  setSetting('reply_agent_enabled', 'true');
  setSetting('kill_switch', 'true');
  const killSwitchResult = await publishReplyCandidate(candidateId);
  assert.equal(killSwitchResult.kind, 'disabled');
  assert.equal(getReplyCandidate(candidateId, db)?.status, 'approved');

  const secondCandidate = upsertDiscoveredReplyCandidate({ ...discovered, post: { ...discovered.post, id: 'post-3' } }, db, now).candidate;
  db.prepare("UPDATE reply_candidates SET status = 'approved', generated_reply = ?, quality_status = 'passed' WHERE id = ?").run('Reply kedua yang lolos gate dan menambah detail implementasi.', secondCandidate.id);
  const firstClaim = db.prepare("UPDATE reply_candidates SET status = 'publishing', publishing_started_at = ? WHERE id = ? AND status = 'approved' AND reply_thread_id IS NULL").run(Date.now(), secondCandidate.id);
  const duplicateClaim = db.prepare("UPDATE reply_candidates SET status = 'publishing', publishing_started_at = ? WHERE id = ? AND status = 'approved' AND reply_thread_id IS NULL").run(Date.now(), secondCandidate.id);
  assert.equal(firstClaim.changes, 1);
  assert.equal(duplicateClaim.changes, 0);
  db.prepare("UPDATE reply_candidates SET status = 'publish_unknown', last_error = 'checker' WHERE id = ?").run(secondCandidate.id);
  setSetting('kill_switch', 'false');
  const unknownResult = await publishReplyCandidate(secondCandidate.id);
  assert.equal(unknownResult.kind, 'publish_unknown');

  const policyRoot = upsertDiscoveredReplyCandidate({ ...discovered, post: { ...discovered.post, id: 'policy-root', username: 'followup_id' } }, db, now).candidate;
  db.prepare("UPDATE reply_candidates SET status = 'posted', reply_thread_id = ?, published_at = ? WHERE id = ?").run('policy-own-reply', now - 45 * 60_000, policyRoot.id);
  const onceLimit = getReplyLimitSnapshot(db, { targetUsername: 'followup_id' }, { quotaUsage: 1, quotaTotal: 5, quotaDuration: 86400, remaining: 4 }, now);
  assert.equal(onceLimit.reason, 'reply_account_once_limit');
  setSetting('reply_account_policy', 'continuations_only');
  setSetting('reply_per_account_daily_max', '2');
  const blockedRoot = upsertDiscoveredReplyCandidate({ ...discovered, post: { ...discovered.post, id: 'policy-second-root', username: 'followup_id' } }, db, now);
  assert.equal(blockedRoot.skipped, true);
  assert.equal(blockedRoot.candidate.last_error, 'reply_continuation_required');
  const continuation = upsertDiscoveredReplyCandidate({
    ...discovered,
    post: { ...discovered.post, id: 'policy-continuation', username: 'followup_id', is_reply: true, replied_to: { id: 'policy-own-reply' } },
    rootThreadId: 'policy-root',
    parentReplyThreadId: 'policy-own-reply',
    isContinuation: true,
  }, db, now);
  assert.equal(continuation.skipped, false);
  assert.equal(continuation.candidate.parent_reply_thread_id, 'policy-own-reply');
  const continuationLimit = getReplyLimitSnapshot(db, { targetUsername: 'followup_id', parentReplyThreadId: 'policy-own-reply' }, { quotaUsage: 1, quotaTotal: 5, quotaDuration: 86400, remaining: 4 }, now);
  assert.equal(continuationLimit.reason, undefined);
  setSetting('reply_account_policy', 'once');

  const metricsNow = Date.now();
  db.prepare("UPDATE reply_candidates SET status = 'posted', reply_thread_id = ?, published_at = ? WHERE id = ?").run('reply-check-1', metricsNow - 8 * 24 * 60 * 60_000, candidateId);
  const metrics: Partial<Record<'views' | 'likes' | 'replies' | 'reposts' | 'quotes' | 'shares', number>> = { views: 12, likes: 3, reposts: 1, shares: 0 };
  captureReplySnapshots(db, candidateId, metricsNow - 8 * 24 * 60 * 60_000, metrics, metricsNow);
  captureReplySnapshots(db, candidateId, metricsNow - 8 * 24 * 60 * 60_000, metrics, metricsNow);
  const snapshotCount = Number((db.prepare('SELECT COUNT(*) AS count FROM reply_metric_snapshots WHERE candidate_id = ?').get(candidateId) as { count: number }).count);
  assert.equal(snapshotCount, 3);
  setSetting('kill_switch', 'true');

  console.log('reply-agent-check: PASS');
  closeDb();
  closeDb = null;
  } finally {
    try { closeDb?.(); } catch {}
    closeDb = null;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
