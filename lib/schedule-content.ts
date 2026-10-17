import { randomInt } from 'node:crypto';
import { getDb, getSetting } from './db';
import { getContentStrategy } from './content-strategy';
import { getContentPillar } from './content-pillars';
import { getContentComposition } from './content-compositions';
import { contentHistoryRepository, releasePrimarySourceReservation, reservePrimarySource } from './content-history';
import { invokeHermesAgent } from './hermes';
import { ensureNaturalQuestionCta, formatPostText, normalizePillarHashtags, runQualityGate, splitOverlongThreadParts } from './quality-gate';
import { fetchCurrentSourceContext, getApprovedSources } from './source-context';
import { THREADS_LIMITS } from './threads-api';

type ContentSlot = { id?: number; pillar: string; post_type: 'education' | 'promotion'; slot_time: number; retry_count?: number };

export async function createScheduledPost(slot: ContentSlot & { id: number }) {
  return createStoredPost(slot, slot.id, getSetting('posting_mode') === 'auto' ? 'scheduled' : 'draft');
}

export async function createManualDraftPost(pillar: string, postType: 'education' | 'promotion') {
  return createStoredPost({ pillar, post_type: postType, slot_time: Date.now() }, -randomInt(1, 2_000_000_000), 'draft');
}

async function createStoredPost(slot: ContentSlot, reservationId: number, passedStatus: 'scheduled' | 'draft') {
  const db = getDb();
  const allSources = getApprovedSources(slot.pillar);
  if (allSources.length === 0) return { error: 'blocked_source' as const };
  const pillarConfig = getContentPillar(slot.pillar);
  const requiresResource = pillarConfig?.source_policy === 'github_repository';
  const candidateSources = allSources.filter(source => !requiresResource || isGitHubRepository(source.url));
  const primaryUrl = reservePrimarySource(db, reservationId, candidateSources.map(source => source.url));
  const primarySource = candidateSources.find(source => source.url === primaryUrl);
  if (!primarySource) return { error: 'Semua tema/sumber utama untuk pilar ini sudah dipakai dalam 14 hari terakhir' };
  try {
    const sourceContext = await fetchCurrentSourceContext([primarySource, ...allSources.filter(source => source.id !== primarySource.id)]);
    if ('error' in sourceContext) return { error: sourceContext.error };
    const requiredResourceUrl = requiresResource ? sourceContext.resourceUrls[0] : undefined;
    if (requiresResource && !requiredResourceUrl) return { error: 'source_transient: Required repository resource unavailable' };

    const retryAttempt = Math.max(0, Number(slot.retry_count) || 0);
    const contentLocale: 'id' | 'en' = getSetting('content_locale') === 'en' || pillarConfig?.locale === 'en' ? 'en' : 'id';
    const strategy = getContentStrategy(slot.pillar, String(slot.slot_time), retryAttempt, contentLocale);
    const composition = getContentComposition(slot.pillar, slot.post_type, String(slot.slot_time), contentLocale);
    const recentTopics = contentHistoryRepository.getRecentTopicsSync(14).slice(0, 12);
    const previousRejected = retryAttempt > 0 && slot.id ? db.prepare(
    "SELECT content, quality_reasons FROM posts WHERE schedule_id = ? AND status = 'quality_failed' ORDER BY created_at DESC LIMIT 1",
  ).get(slot.id) as { content: string; quality_reasons: string | null } | undefined : undefined;
    const recentPosts = db.prepare(
    "SELECT content FROM posts WHERE created_at > ? AND status NOT IN ('quality_failed', 'failed') ORDER BY created_at DESC LIMIT 100",
  ).all(Date.now() - 14 * 24 * 60 * 60 * 1000) as { content: string }[];
    const performanceHint = getPerformanceHint(db);
    const promoOffer = slot.post_type === 'promotion' ? (getSetting('promo_offer') || 'konsultasi kebutuhan website') : undefined;
    const promoReason = slot.post_type === 'promotion' ? (getSetting('promo_reason') || 'agar pembaca tahu langkah perbaikan website yang paling prioritas') : undefined;
    const promoWebsiteUrl = getSetting('website_url') || undefined;
    const generated = await invokeHermesAgent({
    pillar: strategy.label,
    postType: slot.post_type,
    language: contentLocale,
    style: 'casual',
    softSelling: slot.post_type === 'promotion',
    keywords: strategy.keywords,
    avoidTopics: recentTopics.map(topic => topic.topic.slice(0, 100)),
    sources: sourceContext.urls,
    sourceContext: sourceContext.text,
    requiredResourceUrl,
    requiredResourceKind: requiresResource ? pillarConfig?.name : undefined,
    hookInstruction: strategy.hookInstruction,
    hookMechanism: strategy.hookMechanism,
    contentFormat: strategy.contentFormat,
    formatInstruction: strategy.formatInstruction,
    ctaMechanism: strategy.ctaMechanism,
    ctaInstruction: `${strategy.ctaInstruction} ${composition.cta_rule}`,
    compositionHookRule: composition.hook_rule,
    compositionStructureRule: composition.structure_rule,
    compositionPromptText: composition.prompt_text,
    compositionMode: composition.mode,
    hashtagPolicy: composition.hashtag_policy,
    sourceLinkPolicy: composition.source_link_policy,
    standaloneOnly: composition.mode === 'standalone',
    performanceHint,
    promoOffer,
    promoReason,
    promoWebsiteUrl,
    retryAttempt,
    previousRejectedContent: previousRejected?.content,
    previousQualityReasons: parseQualityReasons(previousRejected?.quality_reasons),
    maxLength: Math.min(THREADS_LIMITS.TEXT_LIMIT, composition.max_length),
  });
    if (generated.error) return { error: generated.error };
    generated.text = formatPostText(generated.text);
    generated.replies = generated.replies.map(formatPostText);
    const ensuredCta = ensureNaturalQuestionCta(generated.text, generated.replies, strategy.ctaMechanism, contentLocale);
    generated.text = ensuredCta.text;
    generated.replies = ensuredCta.replies;
    const splitParts = splitOverlongThreadParts(generated.text, generated.replies);
    generated.text = splitParts.text;
    generated.replies = splitParts.replies;
    const normalizedHashtags = normalizePillarHashtags(generated.text, generated.replies, slot.pillar);
    generated.text = normalizedHashtags.text;
    generated.replies = normalizedHashtags.replies;

    const quality = runQualityGate({
    text: generated.text,
    replies: generated.replies,
    pillar: slot.pillar,
    keywords: generated.keywords,
    requiredKeywords: strategy.keywords,
    sourceUrls: sourceContext.urls,
    requiredResourceUrl,
    postType: generated.postType,
    language: contentLocale,
    softSelling: slot.post_type === 'promotion',
    standaloneOnly: composition.mode === 'standalone',
    promoOffer,
    promoReason,
    promoWebsiteUrl,
  }, recentPosts.map(post => post.content));
    const now = Date.now();
    const status = quality.passed ? passedStatus : 'quality_failed';
    const result = db.prepare(`
    INSERT INTO posts (
      schedule_id, content, replies, pillar, post_type, source_urls,
      quality_status, quality_reasons, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    slot.id ?? null,
    generated.text,
    JSON.stringify(generated.replies),
    slot.pillar,
    slot.post_type,
    JSON.stringify(sourceContext.urls),
    quality.passed ? 'passed' : 'failed',
    JSON.stringify(quality.reasons),
    status,
    now,
  );
    const postId = Number(result.lastInsertRowid);
    db.prepare(`INSERT INTO post_attributes (
    post_id, hook_mechanism, content_format, cta_mechanism, paragraph_count, length_chars, posting_hour,
    promotion_flag, source_domains, source_count, source_claims, primary_source_url, topic_tag, composition_slug
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    postId, strategy.hookMechanism, strategy.contentFormat, strategy.ctaMechanism,
    paragraphCount(generated.text), generated.text.length, new Date(slot.slot_time).getHours(),
    slot.post_type === 'promotion' ? 1 : 0, JSON.stringify(sourceDomains(sourceContext.urls)), sourceContext.urls.length,
    JSON.stringify({ synthesis: 'fact_audience_caveat_opinion', sources: sourceContext.urls }), sourceContext.urls[0] || null, strategy.topicTag, composition.slug,
  );
    const assetPlan = planAsset(strategy.contentFormat, slot.pillar);
    db.prepare('INSERT INTO asset_plans (post_id, asset_type, rationale, alt_text_draft, topic_candidate) VALUES (?, ?, ?, ?, ?)')
    .run(postId, assetPlan.type, assetPlan.rationale, assetPlan.alt, assetPlan.topic);
    if (quality.passed) {
      contentHistoryRepository.addSync({
        topicHash: generated.text.slice(0, 100),
        pillar: slot.pillar,
        topic: generated.text.slice(0, 200),
        link: primarySource.url,
        createdAt: now,
      });
    }
    return { postId, status, qualityPassed: quality.passed };
  } finally {
    releasePrimarySourceReservation(db, reservationId, primarySource.url);
  }
}

function planAsset(format: string, pillar: string) {
  const visual = format === 'mini_case' || format === 'process_story' || format === 'evidence_opinion';
  return {
    type: visual ? 'optional_visual' : 'text_only',
    rationale: visual ? `Visual pendukung dapat memperjelas format ${format}; belum diunggah otomatis.` : 'Konten cukup teks; aset tidak diperlukan.',
    alt: `${pillar} — konsep visual pendukung untuk konten ${format}`,
    topic: pillar,
  };
}

function paragraphCount(text: string): number {
  return text.trim().split(/\n\s*\n/).filter(Boolean).length;
}

function sourceDomains(urls: string[]): string[] {
  return urls.map(url => { try { return new URL(url).hostname; } catch { return url; } });
}

function isGitHubRepository(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === 'github.com' && url.pathname.split('/').filter(Boolean).length === 2;
  } catch {
    return false;
  }
}

function parseQualityReasons(value: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((reason): reason is string => typeof reason === 'string') : [];
  } catch {
    return [];
  }
}

function getPerformanceHint(db: ReturnType<typeof getDb>): string | undefined {
  const sample = db.prepare("SELECT COUNT(*) AS count FROM metric_snapshots WHERE checkpoint = '24h'").get() as { count: number };
  if (sample.count < 5) return undefined;
  const hook = db.prepare(`SELECT a.hook_mechanism AS dimension
    FROM post_attributes a JOIN metric_snapshots s ON s.post_id = a.post_id AND s.checkpoint = '24h'
    GROUP BY a.hook_mechanism HAVING COUNT(*) >= 5
    ORDER BY AVG(s.replies + s.quotes) DESC, AVG(s.reposts + s.shares) DESC LIMIT 1`).get() as { dimension: string } | undefined;
  const format = db.prepare(`SELECT a.content_format AS dimension
    FROM post_attributes a JOIN metric_snapshots s ON s.post_id = a.post_id AND s.checkpoint = '24h'
    GROUP BY a.content_format HAVING COUNT(*) >= 5
    ORDER BY AVG(s.reposts + s.shares) DESC, AVG(s.replies + s.quotes) DESC LIMIT 1`).get() as { dimension: string } | undefined;
  if (!hook && !format) return undefined;
  return `Data akun sendiri (n=${sample.count} snapshot 24 jam): prioritaskan sebagai tie-breaker hook ${hook?.dimension || '-'} dan format ${format?.dimension || '-'}; jangan meniru teks atau mengorbankan variasi.`;
}
