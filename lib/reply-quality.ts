export interface ReplyQualityInput {
  replyText: string;
  targetText: string;
  targetLanguage: 'id' | 'en';
  recentReplies?: string[];
  blockedRiskFlags?: string[];
}

export interface ReplyQualityResult {
  passed: boolean;
  score: number;
  reasons: string[];
}

const URL_PATTERN = /(?:https?:\/\/|www\.)\S+/i;
const ENGAGEMENT_BAIT = /\b(?:like|suka|share|bagikan|repost|follow|ikuti|tag|tandai|save|simpan)\b.{0,80}\b(?:post|postingan|ini|teman|orang|komentar|komen|follow|ikuti)\b/i;
const HARD_SELLING = /\b(?:beli|order|pesan|diskon|harga|promo|jasa|konsultasi|cek bio|dm saya|hubungi saya|client|klien)\b/i;
const FABRICATED_CLAIM = /\b(?:klien|client|customer)\s+(?:saya|kami|aku)|\b(?:omzet|revenue|pendapatan|konversi|conversion)\b.{0,40}\b(?:naik|meningkat|bertambah|turun|hasil)|\b(?:saya|kami|aku)\s+(?:sudah|pernah)\s+(?:uji|tes|menguji|membantu)\b/i;
const PROMPT_INJECTION = /\b(?:ignore|abaikan|lupakan|system prompt|developer message|instruksi sebelumnya)\b/i;
const GENERIC_ONLY = /^(?:keren|mantap|setuju|sepakat|bagus|nice|great|thanks|terima kasih|setuju banget|sangat setuju)[.! ]*$/iu;
const QUESTION_PATTERN = /[^?\n]{2,180}\?/gu;
const VALUE_TERMS = /\b(?:workflow|alur|proses|langkah|implementasi|contoh|trade[- ]?off|risiko|biaya|cek|ukur|otomasi|automation|website|ai|agent|developer|builder|umkm|usaha|bisnis|landing page|data|uji|tes|prioritas|fondasi|integrasi|api)\b/iu;

export function runReplyQualityGate(input: ReplyQualityInput): ReplyQualityResult {
  const text = input.replyText.trim();
  const reasons: string[] = [];
  let score = 100;
  const target = input.targetText.trim();
  if (!text) { reasons.push('empty_reply'); score -= 100; }
  if (text.length > 500) { reasons.push('over_official_text_limit'); score -= 100; }
  if (URL_PATTERN.test(text)) { reasons.push('url_not_allowed'); score -= 100; }
  if (/#\p{L}/u.test(text)) { reasons.push('hashtag_not_allowed_by_default'); score -= 100; }
  if (ENGAGEMENT_BAIT.test(text)) { reasons.push('engagement_bait'); score -= 100; }
  if (HARD_SELLING.test(text)) { reasons.push('promotion_or_solicitation'); score -= 100; }
  if (GENERIC_ONLY.test(text) || meaningfulTokens(text).length < 4) { reasons.push('generic_or_non_substantive'); score -= 100; }
  if (FABRICATED_CLAIM.test(text)) { reasons.push('unsupported_personal_or_outcome_claim'); score -= 100; }
  if (PROMPT_INJECTION.test(text)) { reasons.push('prompt_injection_output'); score -= 100; }
  if ((input.blockedRiskFlags || []).some(flag => flag === 'sensitive_category')) { reasons.push('blocked_sensitive_category'); score -= 100; }
  const questions = text.match(QUESTION_PATTERN) || [];
  if (questions.length > 1) { reasons.push('more_than_one_question'); score -= 100; }
  if (target && similarity(text, target) >= 0.78) { reasons.push('target_repetition_without_added_value'); score -= 100; }
  if ((input.recentReplies || []).some(reply => similarity(text, reply) >= 0.72)) { reasons.push('similar_to_recent_outbound_reply'); score -= 100; }
  if (!VALUE_TERMS.test(text) && meaningfulTokens(text).length < 10) { reasons.push('no_useful_implementation_detail'); score -= 25; }
  if (input.targetLanguage === 'id' && englishWordCount(text) > indonesianWordCount(text) + 3) { reasons.push('language_mismatch'); score -= 30; }
  if (input.targetLanguage === 'en' && indonesianWordCount(text) > englishWordCount(text) + 3) { reasons.push('language_mismatch'); score -= 30; }
  return { passed: reasons.length === 0 && score >= 70, score: Math.max(0, score), reasons };
}

export function replySimilarity(left: string, right: string): number {
  return similarity(left, right);
}

function meaningfulTokens(value: string): string[] {
  return [...new Set((value.toLocaleLowerCase('id-ID').match(/[\p{L}\p{N}]{2,}/gu) || []).filter(token => !STOP_WORDS.has(token)))];
}

function similarity(left: string, right: string): number {
  const a = new Set(meaningfulTokens(left));
  const b = new Set(meaningfulTokens(right));
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter(token => b.has(token)).length;
  return shared / Math.max(1, a.size + b.size - shared);
}

function indonesianWordCount(value: string): number {
  return (value.match(/\b(?:yang|dan|untuk|dengan|kalau|bisa|sudah|belum|karena|pakai|lebih|usaha|kamu|saya|kita|bagian|alur|kerja)\b/giu) || []).length;
}

function englishWordCount(value: string): number {
  return (value.match(/\b(?:the|and|for|with|when|can|have|because|use|more|your|you|business|workflow|part|team)\b/giu) || []).length;
}

const STOP_WORDS = new Set('yang dan untuk dengan dari pada ini itu di ke adalah sebagai bisa agar atau juga dalam karena buat bagi sudah akan tidak lebih jika kamu kami saya kita the and for with from this that are is to of a in on your you'.split(' '));
