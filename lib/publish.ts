import { getDb, getSetting, logAudit } from './db';
import { getContentPillar } from './content-pillars';
import { getContentComposition } from './content-compositions';
import { getContentStrategy } from './content-strategy';
import { OFFICIAL_STORE_URL } from './brand-links';
import { rewriteUntilHuman, type HumanizerLintReport } from './humanizer-lint';
import { ensureNaturalQuestionCta, formatPostText, normalizePillarHashtags, runQualityGate, splitOverlongThreadParts } from './quality-gate';
import { claimPostForPublishing } from './publish-claim';
import { postToThreads, THREADS_LIMITS } from './threads-api';

export type PublishStoredPostResult =
  | { kind: 'disabled' }
  | { kind: 'posted'; id: string; url: string; verified: boolean }
  | { kind: 'already_posted'; id: string | null; url: string | null }
  | { kind: 'publishing' }
  | { kind: 'not_publishable'; status: string }
  | { kind: 'not_found' }
  | { kind: 'failed'; error: string; retryable: boolean };

export function isPublishingDisabled(killSwitch: string | null): boolean {
  return killSwitch === 'true';
}

export async function publishStoredPost(postId: number, allowedStatuses: string[]): Promise<PublishStoredPostResult> {
  if (isPublishingDisabled(getSetting('kill_switch'))) return { kind: 'disabled' };
  const db = getDb();
  const claim = claimPostForPublishing(db, postId, allowedStatuses);

  if (claim.kind === 'already_posted') {
    return { kind: 'already_posted', id: claim.post.threads_id, url: claim.post.threads_url };
  }
  if (claim.kind === 'publishing') return { kind: 'publishing' };
  if (claim.kind === 'not_publishable') return { kind: 'not_publishable', status: claim.post.status };
  if (claim.kind === 'not_found') return { kind: 'not_found' };

  let replies: string[];
  try {
    const parsed: unknown = claim.post.replies ? JSON.parse(claim.post.replies) : [];
    if (!Array.isArray(parsed) || !parsed.every(reply => typeof reply === 'string')) throw new Error('invalid replies');
    replies = parsed;
  } catch {
    blockHumanizerDraft(db, postId, 'invalid replies');
    return { kind: 'not_publishable', status: 'blocked_humanizer' };
  }

  const humanized = await humanizeUnpublishedDraft(db, postId, claim.post.content, replies);
  if (humanized.error) {
    blockHumanizerDraft(db, postId, humanized.error, humanized.report.violations);
    return { kind: 'not_publishable', status: 'blocked_humanizer' };
  }

  const attributes = db.prepare('SELECT topic_tag FROM post_attributes WHERE post_id = ?').get(postId) as { topic_tag: string | null } | undefined;
  const result = await postToThreads({
    text: humanized.text,
    replies: humanized.replies,
    topicTag: attributes?.topic_tag || undefined,
  });

  if ('partial' in result) {
    db.prepare("UPDATE posts SET status = 'publish_unknown', threads_id = ?, threads_url = ?, reply_ids = ?, posted_at = ? WHERE id = ? AND status = 'publishing'")
      .run(result.id, result.url, JSON.stringify(result.replyIds), Date.now(), postId);
    logAudit('post_partial', `post ${postId}: root=${result.id} ${result.error}`);
    return { kind: 'failed', error: result.error, retryable: false };
  }

  if ('error' in result) {
    const status = result.safeToRetry ? 'failed' : 'publish_unknown';
    db.prepare('UPDATE posts SET status = ?, retry_count = retry_count + 1 WHERE id = ? AND status = ?')
      .run(status, postId, 'publishing');
    logAudit('post_failed', `post ${postId}: retryable=${result.safeToRetry} ${result.error}`);
    return { kind: 'failed', error: result.error, retryable: result.safeToRetry };
  }

  db.prepare(
    'UPDATE posts SET status = ?, threads_id = ?, threads_url = ?, reply_ids = ?, posted_at = ? WHERE id = ? AND status = ?'
  ).run(result.verified ? 'posted' : 'posted_unverified', result.id, result.url, JSON.stringify(result.replyIds), Date.now(), postId, 'publishing');
  logAudit('post_success', `post ${postId}: ${result.id} verified=${result.verified}`);
  return { kind: 'posted', id: result.id, url: result.url, verified: result.verified };
}

type PublishMetadata = {
  pillar: string | null;
  post_type: string | null;
  source_urls: string | null;
  schedule_id: number | null;
  created_at: number;
  retry_count: number;
  slot_time: number | null;
};

type PreparedPublishDraft = {
  text: string;
  replies: string[];
  report: HumanizerLintReport;
  error?: string;
};

async function humanizeUnpublishedDraft(
  db: ReturnType<typeof getDb>,
  postId: number,
  text: string,
  replies: string[],
): Promise<PreparedPublishDraft> {
  const metadata = db.prepare(`
    SELECT p.pillar, p.post_type, p.source_urls, p.schedule_id, p.created_at, p.retry_count, s.slot_time
    FROM posts p LEFT JOIN schedule s ON s.id = p.schedule_id
    WHERE p.id = ?
  `).get(postId) as PublishMetadata | undefined;
  if (!metadata?.pillar || (metadata.post_type !== 'education' && metadata.post_type !== 'promotion')) {
    return { text, replies, report: errorHumanizerReport('publish metadata tidak valid'), error: 'publish metadata tidak valid' };
  }

  const postType = metadata.post_type;
  const pillarConfig = getContentPillar(metadata.pillar, db);
  const language: 'id' | 'en' = getSetting('content_locale') === 'en' || pillarConfig?.locale === 'en' ? 'en' : 'id';
  const seed = String(metadata.slot_time ?? metadata.created_at ?? postId);
  const retryAttempt = Math.max(0, Number(metadata.retry_count) || 0);
  const strategy = getContentStrategy(metadata.pillar, seed, retryAttempt, language);
  const composition = getContentComposition(metadata.pillar, postType, seed, language, db);
  const sourceUrls = parseStringArray(metadata.source_urls);
  const requiredResourceUrl = pillarConfig?.source_policy === 'github_repository' ? sourceUrls[0] : undefined;
  const promoWebsiteUrl = postType === 'promotion' ? OFFICIAL_STORE_URL : undefined;
  const promoOffer = postType === 'promotion' ? (getSetting('promo_offer') || 'konsultasi kebutuhan website') : undefined;
  const promoReason = postType === 'promotion' ? (getSetting('promo_reason') || 'agar pembaca tahu langkah perbaikan website yang paling prioritas') : undefined;
  const maxLength = Math.min(THREADS_LIMITS.TEXT_LIMIT, composition.max_length);

  const humanized = await rewriteUntilHuman({
    text,
    replies,
    pillar: metadata.pillar,
    postType,
    language,
    maxLength,
    sourceUrls,
    requiredResourceUrl,
    promoWebsiteUrl,
  }, post => {
    const formatted = {
      text: formatPostText(post.text),
      replies: post.replies.map(formatPostText),
    };
    const cta = ensureNaturalQuestionCta(formatted.text, formatted.replies, strategy.ctaMechanism, language);
    const split = splitOverlongThreadParts(cta.text, cta.replies);
    return normalizePillarHashtags(split.text, split.replies, metadata.pillar!);
  });
  if (humanized.error) return humanized;

  const recentPosts = db.prepare(`
    SELECT content FROM posts
    WHERE id <> ? AND created_at > ? AND status NOT IN ('quality_failed', 'failed', 'blocked_humanizer', 'superseded')
    ORDER BY created_at DESC LIMIT 100
  `).all(postId, Date.now() - 14 * 24 * 60 * 60 * 1000) as { content: string }[];
  const quality = runQualityGate({
    text: humanized.text,
    replies: humanized.replies,
    pillar: metadata.pillar,
    keywords: strategy.keywords,
    requiredKeywords: strategy.keywords,
    sourceUrls,
    requiredResourceUrl,
    postType,
    softSelling: postType === 'promotion',
    standaloneOnly: composition.mode === 'standalone',
    promoOffer,
    promoReason,
    promoWebsiteUrl,
    language,
  }, recentPosts.map(post => post.content));
  if (!quality.passed) {
    return { ...humanized, error: `quality_gate_after_humanizer: ${quality.reasons.join('; ')}` };
  }

  try {
    db.exec('BEGIN IMMEDIATE');
    const updated = db.prepare(`
      UPDATE posts SET content = ?, replies = ?
      WHERE id = ? AND status = 'publishing' AND threads_id IS NULL
    `).run(humanized.text, JSON.stringify(humanized.replies), postId);
    if (Number(updated.changes) !== 1) throw new Error('post claim changed before humanizer persistence');
    db.prepare('UPDATE post_attributes SET paragraph_count = ?, length_chars = ? WHERE post_id = ?')
      .run(paragraphCount(humanized.text), humanized.text.length, postId);
    logAudit('humanizer_publish_passed', `post=${postId} version=${humanized.report.version} score=${humanized.report.score ?? 'null'} rewrites=${humanized.rewrites}`, db);
    db.exec('COMMIT');
  } catch (error: unknown) {
    try { db.exec('ROLLBACK'); } catch {}
    return { ...humanized, error: `humanizer persistence failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  return humanized;
}

function blockHumanizerDraft(db: ReturnType<typeof getDb>, postId: number, details: string, violations: string[] = []): void {
  const reasons = [details, ...violations].filter(Boolean).slice(0, 12);
  const changed = db.prepare(`
    UPDATE posts SET status = 'blocked_humanizer', quality_status = 'failed', quality_reasons = ?
    WHERE id = ? AND status = 'publishing' AND threads_id IS NULL
  `).run(JSON.stringify(reasons), postId);
  logAudit('publish_blocked_humanizer', `post=${postId} changed=${Number(changed.changes)} ${details.slice(0, 300)}`);
}

function parseStringArray(value: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function paragraphCount(text: string): number {
  return text.trim().split(/\n\s*\n/).filter(Boolean).length;
}

function errorHumanizerReport(error: string): HumanizerLintReport {
  return { status: 'ERROR', score: null, language: null, violations: [], suppressed: 0, version: 'unknown', error };
}
