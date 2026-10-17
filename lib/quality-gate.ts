import { THREADS_LIMITS } from './threads-api';

export interface QualityResult {
  passed: boolean;
  score: number;
  reasons: string[];
}

export interface PostContent {
  text: string;
  replies: string[];
  pillar?: string;
  keywords: string[];
  requiredKeywords?: string[];
  sourceUrls: string[];
  requiredResourceUrl?: string;
  postType: 'education' | 'promotion';
  softSelling: boolean;
  standaloneOnly?: boolean;
  promoOffer?: string;
  promoReason?: string;
  promoWebsiteUrl?: string;
  language?: 'id' | 'en';
}

const HASHTAG_PATTERN = /#[\p{L}\p{N}_]+/gu;
const URL_PATTERN = /https?:\/\/[^\s<>()]+/gi;
const LINK_SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'buff.ly']);
const TRACKING_PARAM = /^(?:utm_[a-z_]+|fbclid|gclid|mc_[a-z_]+)$/i;
const ENGAGEMENT_BAIT_PATTERNS = [
  /\b(?:like|suka|love)\s+(?:postingan|post|ini)\b/i,
  /\b(?:share|bagikan|repost)\s+(?:postingan|post|ini|ke\s+\d+|ke semua)\b/i,
  /\b(?:tag|tandai)\s+(?:\d+\s*)?(?:teman|orang)\b/i,
  /\b(?:follow|ikuti)\b.{0,48}\b(?:untuk|agar|biar|supaya)\b/i,
  /\b(?:tulis|ceritakan|jawab|balas|komen|komentar)\b.{0,64}\b(?:komentar|komen|di bawah)\b/i,
  /\b(?:tulis|komen|komentar|balas)\b.{0,64}\b(?:done|hadir|amin|setuju|angka|kata)\b/i,
  /\b(?:simpan|save)\s+(?:postingan|post|panduan|catatan)\s+ini\b/i,
];
const PILLAR_HASHTAG_RULES: Record<string, { allowed: string[]; fallback: string }> = {
  github: { allowed: ['#github', '#Tech'], fallback: '#github' },
  ai: { allowed: ['#vibecoding', '#AI'], fallback: '#AI' },
  security: { allowed: ['#vibecoding', '#AI'], fallback: '#AI' },
  umkm: { allowed: ['#UMKM'], fallback: '#UMKM' },
};

export function runQualityGate(content: PostContent, recentPosts: string[] = []): QualityResult {
  const reasons: string[] = [];
  let score = 100;
  const mainText = content.text.trim();
  const fullText = `${mainText} ${(content.replies || []).join(' ')}`.trim();
  const hook = firstSentence(mainText);
  if (content.standaloneOnly && content.replies.some(Boolean)) {
    reasons.push('Konten harus mandiri dalam satu post; balasan thread tidak dipakai');
    score -= 100;
  }

  // 1. Hook check
  if (hook.length < 20) {
    reasons.push('Hook terlalu pendek — harus kuat di kalimat pertama');
    score -= 20;
  }
  if (!hasHookSignal(hook, content.language || 'id')) {
    reasons.push('Hook harus menunjukkan masalah, kontras, pertanyaan, bukti atau observasi sumber, rasa ingin tahu yang dibayar isi, angka, atau hasil spesifik');
    score -= 35;
  }

  const misleadingBait = [
    /pasti viral/i,
    /dijamin viral/i,
    /rahasia yang (?:tidak|mereka) (?:ingin|mau) kamu tahu/i,
    /100% (?:berhasil|ampuh)/i,
    /tanpa (?:usaha|modal|risiko) sama sekali/i,
  ];
  if (misleadingBait.some(pattern => pattern.test(hook))) {
    reasons.push('Hook mengandung klaim clickbait yang tidak dapat diverifikasi');
    score -= 25;
  }

  // Meta's published policy is about deceptive or artificial engagement, not a secret list of words.
  // Keep natural questions, but reject explicit engagement-bait instructions.
  if (ENGAGEMENT_BAIT_PATTERNS.some(pattern => pattern.test(fullText))) {
    reasons.push('CTA engagement bait dilarang; gunakan satu pertanyaan pengalaman yang natural');
    score -= 100;
  }

  // 2. SEO keyword plan: trust the server-selected plan, not model metadata.
  const requiredKeywords = uniqueKeywords(content.requiredKeywords?.length ? content.requiredKeywords : content.keywords);
  if (requiredKeywords.length > 0) {
    const [primaryKeyword, ...derivatives] = requiredKeywords;
    if (!containsKeyword(mainText.slice(0, 100), primaryKeyword)) {
      reasons.push(`Kata kunci utama ("${primaryKeyword}") harus di 100 karakter awal`);
      score -= 15;
    }
    if (derivatives.length > 0 && !derivatives.some(keyword => containsKeyword(fullText, keyword))) {
      reasons.push('Minimal satu kata kunci turunan harus dipakai secara natural');
      score -= 15;
    }
  } else {
    reasons.push('Tidak ada rencana kata kunci SEO');
    score -= 15;
  }

  // 3. Source check
  if (!content.sourceUrls?.length) {
    reasons.push('Tidak ada tautan sumber');
    score -= 25;
  } else {
    for (const url of content.sourceUrls) {
      try {
        new URL(url);
      } catch {
        reasons.push(`Tautan tidak valid: ${url}`);
        score -= 10;
      }
    }
  }

  // 4. Required repository/skill URL check
  if (content.requiredResourceUrl && !fullText.includes(content.requiredResourceUrl)) {
    reasons.push(`URL ${content.requiredResourceUrl} wajib dicantumkan penuh di konten`);
    score -= 100;
  }

  const contentUrls = extractContentUrls(fullText);
  if (contentUrls.length > 1) {
    reasons.push('Maksimal satu URL eksternal canonical per konten; jangan menumpuk tautan');
    score -= 100;
  }
  for (const url of contentUrls) {
    if (url.protocol !== 'https:') {
      reasons.push('URL publik harus HTTPS');
      score -= 100;
    }
    if (url.username || url.password || LINK_SHORTENERS.has(url.hostname.toLocaleLowerCase('en-US'))) {
      reasons.push('URL shortener atau URL dengan kredensial dilarang');
      score -= 100;
    }
    if ([...url.searchParams.keys()].some(key => TRACKING_PARAM.test(key))) {
      reasons.push('URL tracking dilarang; gunakan tautan canonical');
      score -= 100;
    }
  }

  // 5. Length check
  if (fullText.length > THREADS_LIMITS.TEXT_LIMIT * (1 + (content.replies?.length || 0))) {
    reasons.push(`Konten terlalu panjang (${fullText.length} karakter)`);
    score -= 20;
  }
  const overlongPart = [mainText, ...(content.replies || [])].findIndex(part => part.length > THREADS_LIMITS.TEXT_LIMIT);
  if (overlongPart >= 0) {
    reasons.push(`${overlongPart === 0 ? 'Post utama' : `Balasan ${overlongPart}`} melebihi ${THREADS_LIMITS.TEXT_LIMIT} karakter`);
    score -= 100;
  }

  // 5. Hard selling check
  const hardSellingPatterns = [
    /beli sekarang/i,
    /diskon terbatas/i,
    /harga promo/i,
    /hanya hari ini/i,
    /stock limited/i,
    /order now/i,
    /limited time/i,
  ];
  for (const pattern of hardSellingPatterns) {
    if (pattern.test(fullText)) {
      reasons.push(`Deteksi hard selling: "${pattern.source}"`);
      score -= 30;
    }
  }

  // 6. Conversation prompt — exactly one substantive, natural question.
  const ctaCount = countNaturalQuestionCtas(fullText);
  if (ctaCount === 0) {
    reasons.push('Konten wajib memiliki satu CTA engagement yang natural');
    score -= 40;
  }
  if (ctaCount > 1) {
    reasons.push('Terlalu banyak CTA (maksimal 1 per postingan)');
    score -= 15;
  }

  // 7. Core-topic duplicate check: rejects paraphrases, not only byte-identical copy.
  for (const recent of recentPosts) {
    if (topicSimilarity(fullText, recent) >= 0.4) {
      reasons.push('Inti konten terlalu mirip dengan postingan 14 hari terakhir');
      score -= 100;
      break;
    }
  }

  const currentYear = String(new Date().getFullYear());
  const staleYears = (fullText.match(/\b20\d{2}\b/g) || []).filter(year => year !== currentYear);
  if (staleYears.length > 0) {
    reasons.push(`Konten menyebut tahun lama: ${[...new Set(staleYears)].join(', ')}`);
    score -= 100;
  }

  // 8. Education/promotion boundary
  if (content.postType === 'education' && content.promoWebsiteUrl && fullText.toLocaleLowerCase('en-US').includes(content.promoWebsiteUrl.toLocaleLowerCase('en-US'))) {
    reasons.push(`Konten edukasi tidak boleh memuat ${content.promoWebsiteUrl} atau CTA jualan`);
    score -= 100;
  }
  if (content.postType === 'promotion') {
    if (!content.softSelling) {
      reasons.push('Promosi harus soft selling');
      score -= 20;
    }
    if (content.promoOffer && !containsKeyword(fullText, content.promoOffer)) {
      reasons.push('Promosi wajib menyebut offer yang relevan');
      score -= 40;
    }
    if (content.promoReason && !containsKeyword(fullText, content.promoReason)) {
      reasons.push('Promosi wajib menyebut alasan/benefit yang relevan');
      score -= 40;
    }
  }

  // 9. Language check
  const englishPhrases = ['in today', 'in this', 'is a', 'this is a'];
  if ((content.language || 'id') === 'id' && englishPhrases.filter(phrase => fullText.toLowerCase().includes(phrase)).length > 2) {
    reasons.push('Konten terlalu banyak Bahasa Inggris');
    score -= 10;
  }

  // 10. Hashtag check
  const hashtags = fullText.match(HASHTAG_PATTERN) || [];
  if (hashtags.length < 1 || hashtags.length > 3) {
    reasons.push('Jumlah hashtag harus 1-3 yang relevan');
    score -= 10;
  } else if (new Set(hashtags.map(tag => tag.toLocaleLowerCase('id-ID'))).size !== hashtags.length) {
    reasons.push('Hashtag tidak boleh diulang');
    score -= 10;
  }
  const hashtagRule = content.pillar ? PILLAR_HASHTAG_RULES[content.pillar] : undefined;
  if (hashtagRule && !hashtagRule.allowed.some(tag => tag.toLocaleLowerCase('id-ID') === hashtags[0]?.toLocaleLowerCase('id-ID'))) {
    reasons.push(`Hashtag pertama wajib ${hashtagRule.allowed.join(' atau ')}`);
    score -= 100;
  }

  return { passed: score >= 70, score: Math.max(0, score), reasons };
}

export function formatPostText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map(paragraph => paragraph.split('\n').map(line => line.trim().replace(/[\t ]+/g, ' ')).filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function ensureNaturalQuestionCta(text: string, replies: string[], mechanism = '', language: 'id' | 'en' = 'id'): { text: string; replies: string[] } {
  const parts = [text, ...replies];
  if (countNaturalQuestionCtas(parts.join(' ')) === 1) return { text, replies };
  const options = language === 'en'
    ? mechanism === 'choice_ab'
      ? ['Which would you fix first: the workflow or the next feature?', 'Would you fix the foundation now or add another feature first?']
      : mechanism === 'self_diagnosis'
        ? ['Which part of your workflow most often gets stuck?', 'Where does your process most often need a second check?']
        : mechanism === 'counter_opinion'
          ? ['Which part of this approach would you challenge?', 'Would you prioritize this step, or choose another first?']
          : ['Where does this problem most often appear in your team?', 'What part of this process causes the most friction for you?']
    : mechanism === 'choice_ab'
      ? ['Di kerjaanmu, kamu lebih pilih rapikan alurnya sekarang atau tunggu masalahnya makin sering muncul?', 'Kalau harus pilih satu dulu, kamu rapikan fondasi atau tambah fitur baru?']
      : mechanism === 'self_diagnosis'
        ? ['Bagian mana dari alur kerjamu yang paling sering bikin proses berhenti di tengah?', 'Di titik mana prosesmu paling sering butuh dicek ulang?']
        : mechanism === 'counter_opinion'
          ? ['Menurutmu, bagian mana dari pendekatan ini yang paling layak diperdebatkan?', 'Kamu setuju langkah ini didahulukan, atau ada prioritas lain?']
          : ['Pengalamanmu, bagian mana yang paling sering jadi titik macet?', 'Masalah seperti ini paling sering muncul di bagian mana di timmu?'];
  const cta = options[text.length % options.length];
  const last = parts.length - 1;
  const candidate = `${parts[last]}\n\n${cta}`;
  if (candidate.length <= THREADS_LIMITS.TEXT_LIMIT) parts[last] = candidate;
  else parts.push(cta);
  return { text: parts[0], replies: parts.slice(1) };
}

export function splitOverlongThreadParts(text: string, replies: string[]): { text: string; replies: string[] } {
  const parts = [text, ...replies].flatMap(splitThreadPart);
  return { text: parts[0] || '', replies: parts.slice(1) };
}

function splitThreadPart(value: string): string[] {
  const parts: string[] = [];
  let remaining = value.trim();
  while (remaining.length > THREADS_LIMITS.TEXT_LIMIT) {
    const window = remaining.slice(0, THREADS_LIMITS.TEXT_LIMIT + 1);
    const splitAt = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '), window.lastIndexOf(' '));
    const cut = splitAt > 120 ? splitAt + (/[.!?]/.test(remaining[splitAt]) ? 1 : 0) : THREADS_LIMITS.TEXT_LIMIT;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

export function normalizePillarHashtags(text: string, replies: string[], pillar: string): { text: string; replies: string[] } {
  const rule = PILLAR_HASHTAG_RULES[pillar];
  const parts = [text, ...replies];
  if (!rule) return { text: formatPostText(text), replies: replies.map(formatPostText) };

  const hashtags = parts.flatMap(part => part.match(HASHTAG_PATTERN) || []);
  const allowed = new Map(rule.allowed.map(tag => [tag.toLocaleLowerCase('id-ID'), tag]));
  const selected = allowed.get(hashtags.find(tag => allowed.has(tag.toLocaleLowerCase('id-ID')))?.toLocaleLowerCase('id-ID') || '') || rule.fallback;
  const seen = new Set(allowed.keys());
  const extras: string[] = [];
  for (const tag of hashtags) {
    const key = tag.toLocaleLowerCase('id-ID');
    if (seen.has(key)) continue;
    seen.add(key);
    extras.push(tag);
    if (extras.length === 2) break;
  }

  const normalized = parts.map(part => formatPostText(part.replace(HASHTAG_PATTERN, ' ')));
  const target = normalized.length - 1;
  const selectedTags = [selected];
  for (const extra of extras) {
    const candidate = formatPostText(`${normalized[target]}\n\n${[...selectedTags, extra].join(' ')}`);
    if (candidate.length <= THREADS_LIMITS.TEXT_LIMIT) selectedTags.push(extra);
  }
  const candidate = formatPostText(`${normalized[target]}\n\n${selectedTags.join(' ')}`);
  if (candidate.length <= THREADS_LIMITS.TEXT_LIMIT) normalized[target] = candidate;
  else normalized.push(selected);
  return { text: normalized[0], replies: normalized.slice(1) };
}

function firstSentence(text: string): string {
  return (text.slice(0, 140).match(/^[\s\S]*?[.!?](?=\s|$)|^[\s\S]+$/)?.[0] || '').trim();
}

function hasHookSignal(hook: string, language: 'id' | 'en' = 'id'): boolean {
  if (language === 'en') return [
    /\b\d+\b/,
    /\?$/,
    /\b(?:instead|rather|although|but|yet|before|after|only|first|most|why|how|what|when|problem|mistake|result|cost|risk|source)\b/i,
  ].some(pattern => pattern.test(hook));
  return [
    /\b\d+\b/,
    /\?$/,
    /\b(bukan|ternyata|alih-alih|daripada|padahal|meski|walau)\b/i,
    /\b(banyak\s+(?:pembeli|pesanan|transaksi|pemilik|usaha|akun|tim)|coba|tes|pilih)\b/i,
    /\b(?:banyak yang (?:kira|mengira|anggap|menganggap)|terlalu|observasi|dulu|bikin|bereskan|pakai|rugi|abaikan|mengabaikan|mengorbankan|percuma|masih|sering|saat|ketika|tanpa|faktanya|nyatanya|uji|pasrah)\b/i,
    /\b(kesalahan|jangan|hindari|stop|masalah|sulit|bingung|lambat|lelet|sepi|gagal|batal|rugi|boros)\b/i,
    /\b(cara|langkah|contoh|template|checklist|ceklist|tips|panduan)\b/i,
    /\b(?:pasang|mulai|pilih|pakai|cek|ukur|bandingkan|hindari|tunda|putuskan|patuhi)\b[\s\S]{0,100}\batau\b/i,
    /\b(menurut|berdasarkan|data|laporan|catatan|dokumentasi|riset|studi)\b/i,
    /\b(ini yang|yang sering|yang bikin|yang membuat|alasannya|dampaknya|hasilnya)\b/i,
  ].some(pattern => pattern.test(hook));
}

function countNaturalQuestionCtas(text: string): number {
  const cleaned = text.replace(/(?:#[\p{L}\p{N}_]+\s*)+$/gu, '').trim();
  const tailStart = Math.max(0, cleaned.length - 280);
  const tail = cleaned.slice(tailStart);
  const questions = [...tail.matchAll(/(?:\b(?:apa|apakah|mana|bagaimana|kenapa|kamu|kalian|pilih|pernah|sudah|masih|lebih suka|atau|tim|menurutmu|which|what|where|when|why|how|would|could|should|your|you|team|experience)\b|\b[\p{L}]+mu\b)[^?]{0,180}\?/giu)];
  const question = questions.at(-1);
  let count = question ? 1 : 0;
  if (!question && /\bpilih(?: mana)?\s*:\s*A[.):][\s\S]{0,100}\bB[.):]/iu.test(tail)) count = 1;
  return count;
}

function extractContentUrls(text: string): URL[] {
  const urls: URL[] = [];
  for (const match of text.match(URL_PATTERN) || []) {
    try { urls.push(new URL(match.replace(/[.,!?]+$/, ''))); } catch {}
  }
  return urls;
}

function uniqueKeywords(keywords: string[] = []): string[] {
  return [...new Set(keywords.map(keyword => keyword.trim()).filter(Boolean))];
}

function containsKeyword(text: string, keyword: string): boolean {
  return normalize(text).includes(normalize(keyword));
}

function topicSimilarity(left: string, right: string): number {
  const tokens = (value: string) => new Set((normalize(value).match(/[a-z0-9]{4,}/g) || []).filter(token => !STOP_WORDS.has(token)));
  const a = tokens(left);
  const b = tokens(right);
  const shared = [...a].filter(token => b.has(token)).length;
  return shared / Math.max(1, a.size + b.size - shared);
}

const STOP_WORDS = new Set('yang dan untuk dengan dari pada ini itu di ke adalah sebagai bisa agar atau juga dalam karena buat bagi sudah akan tidak lebih jika kamu kami saya'.split(' '));

function normalize(value: string): string {
  return ` ${value.toLocaleLowerCase('id-ID').replace(/[^a-z0-9]+/gi, ' ').trim()} `;
}
