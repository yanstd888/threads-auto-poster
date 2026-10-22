import { getContentPillar } from './content-pillars';

export interface ContentStrategy {
  label: string;
  topicTag: string;
  keywords: string[];
  hookInstruction: string;
  hookMechanism: string;
  contentFormat: string;
  formatInstruction: string;
  ctaMechanism: string;
  ctaInstruction: string;
}

type Strategy = {
  label: string;
  topicTag: string;
  clusters: string[][];
};

const STRATEGIES: Record<string, Strategy> = {
  github: {
    label: 'GitHub repo terbaik',
    topicTag: 'GitHub',
    clusters: [
      ['repo GitHub terbaik', 'repository open source', 'tools developer gratis'],
      ['GitHub trending', 'repo open source terbaru', 'project coding untuk portofolio'],
      ['proyek open source untuk pemula', 'contoh project GitHub', 'belajar coding dari GitHub'],
    ],
  },
  ai: {
    label: 'AI agent skill terbaik',
    topicTag: 'Artificial Intelligence',
    clusters: [
      ['AI agent', 'tools AI untuk kerja', 'otomatisasi dengan AI'],
      ['agent skill', 'workflow AI agent', 'skill AI agent terbaik'],
      ['tools AI gratis', 'cara memakai AI untuk kerja', 'otomatisasi kerja dengan AI'],
    ],
  },
  umkm: {
    label: 'Website untuk UMKM',
    topicTag: 'Small Business',
    clusters: [
      ['website UMKM', 'website bisnis profesional', 'cara membuat website usaha'],
      ['jasa pembuatan website', 'website untuk bisnis kecil', 'digital marketing UMKM'],
      ['go digital UMKM', 'contoh website usaha', 'website untuk meningkatkan penjualan'],
    ],
  },
  security: {
    label: 'Cyber security',
    topicTag: 'Cybersecurity',
    clusters: [
      ['keamanan siber', 'tips keamanan akun', 'cara menghindari phishing'],
      ['keamanan website', 'cyber security untuk bisnis', 'melindungi akun online'],
      ['cara mengamankan akun', 'tanda phishing', 'keamanan data bisnis'],
    ],
  },
  'ai-news-update': {
    label: 'NewsAI / Berita AI terbaru',
    topicTag: 'AI News',
    clusters: [
      ['berita AI terbaru', 'perkembangan kecerdasan buatan', 'update AI hari ini'],
      ['rilis model AI', 'riset AI terbaru', 'dampak AI untuk developer'],
      ['AI agents terbaru', 'kebijakan AI', 'tren AI global'],
    ],
  },
  'programmer-quotes': {
    label: 'Quotes of the day — Programmer/VibeCoder',
    topicTag: 'Programmer Mindset',
    clusters: [
      ['quote programmer', 'kutipan coding', 'mindset developer'],
      ['quote software engineering', 'clean code', 'belajar programming'],
      ['VibeCoder', 'developer mindset', 'kualitas kode'],
    ],
  },
};

const FALLBACK: Strategy = STRATEGIES.github;
const EN_STRATEGIES: Record<string, Strategy> = {
  github: { label: 'Best GitHub repositories', topicTag: 'GitHub', clusters: [['best GitHub repositories', 'open source repositories', 'free developer tools'], ['GitHub trending', 'new open source repositories', 'coding projects for portfolios']] },
  ai: { label: 'Best AI agent skills', topicTag: 'Artificial Intelligence', clusters: [['AI agents', 'AI tools for work', 'automation with AI'], ['agent skills', 'AI agent workflows', 'best AI agent skills']] },
  umkm: { label: 'Websites for small businesses', topicTag: 'Small Business', clusters: [['small business website', 'professional business website', 'how to build a business website'], ['website for small businesses', 'small business digital marketing', 'grow a small business online']] },
  security: { label: 'Cybersecurity', topicTag: 'Cybersecurity', clusters: [['cybersecurity', 'account security tips', 'how to avoid phishing'], ['website security', 'cybersecurity for business', 'protect online accounts']] },
};

const HOOK_MECHANISMS = ['source_impact', 'tradeoff', 'symptom_diagnosis', 'evidence_result', 'curiosity_answered', 'practical_observation', 'misconception_correction', 'self_diagnosis', 'before_after', 'decision_consequence', 'quick_test', 'specific_question'];
const CONTENT_FORMATS = [
  ['source_consequence', 'Mulai dari satu temuan sumber, lalu tunjukkan akibatnya dalam situasi kerja pembaca.'],
  ['tradeoff', 'Bandingkan dua pilihan nyata; beri pembaca alasan memilih, bukan sekadar definisi.'],
  ['mini_case', 'Buat teardown pendek: masalah yang terlihat, keputusan kecil, lalu dampaknya. Jangan mengarang hasil atau pengalaman pribadi.'],
  ['checklist', 'Tulis 2-3 cek cepat yang bisa dilakukan hari ini, bukan daftar teori.'],
  ['misconception', 'Buka dengan asumsi yang sering muncul, lalu koreksi dengan bukti dan contoh kerja nyata.'],
  ['process_story', 'Gunakan alur gesekan → langkah → pelajaran praktis tanpa mengaku punya pengalaman yang tidak ada di sumber.'],
  ['evidence_opinion', 'Buat opini tegas tapi wajar, lalu uji dengan satu bukti dan satu batasannya.'],
] as const;
const CTA_MECHANISMS = [
  ['choice_ab', 'Akhiri dengan satu pilihan A/B yang mudah dijawab.'],
  ['field_experience', 'Akhiri dengan satu pertanyaan pengalaman lapangan yang spesifik.'],
  ['self_diagnosis', 'Akhiri dengan satu pertanyaan diagnosis singkat untuk kondisi pembaca.'],
  ['counter_opinion', 'Akhiri dengan satu pertanyaan pendapat kontra yang relevan.'],
] as const;

const HOOK_INSTRUCTIONS = [
  'Mulai dari masalah atau kerugian nyata yang dapat dijelaskan oleh SOURCE EXCERPTS.',
  'Mulai dari kontras yang membantah asumsi umum, lalu buktikan dengan SOURCE EXCERPTS.',
  'Mulai dari gejala spesifik yang bisa dikenali pembaca, lalu tunjukkan penyebab atau langkah berikutnya.',
  'Mulai dari hasil atau perubahan yang bisa dibuktikan oleh SOURCE EXCERPTS, bukan janji.',
  'Mulai dengan rasa ingin tahu yang jujur: sebut detail penting dari SOURCE EXCERPTS, lalu jawab di isi.',
  'Mulai dari observasi atau pola praktis yang muncul dari SOURCE EXCERPTS.',
  'Mulai dari trade-off nyata: apa yang dikorbankan jika satu pilihan diabaikan.',
  'Mulai dari miskonsepsi yang dikoreksi oleh SOURCE EXCERPTS.',
  'Mulai dari pertanyaan diagnosis yang membuat pembaca mengecek kondisi mereka sendiri.',
  'Mulai dari perbandingan sebelum/sesudah atau lama/baru yang didukung SOURCE EXCERPTS.',
  'Mulai dari keputusan praktis yang harus diambil pembaca, dengan konsekuensi yang jelas.',
  'Mulai dari langkah uji singkat yang dapat langsung dilakukan pembaca berdasarkan SOURCE EXCERPTS.',
];
const EN_HOOK_INSTRUCTIONS = [
  'Start with a real problem or loss that SOURCE EXCERPTS can explain.',
  'Start with a contrast that challenges a common assumption, then prove it with SOURCE EXCERPTS.',
  'Start with a specific symptom readers can recognize, then show the cause or next step.',
  'Start with a result supported by SOURCE EXCERPTS, not a promise.',
  'Start with honest curiosity: name an important detail from SOURCE EXCERPTS, then answer it.',
  'Start with a practical observation or pattern from SOURCE EXCERPTS.',
  'Start with a real trade-off and what gets sacrificed when one option is ignored.',
  'Start with a misconception corrected by SOURCE EXCERPTS.',
  'Start with a diagnostic question that makes readers check their own situation.',
  'Start with a before/after or old/new comparison supported by SOURCE EXCERPTS.',
  'Start with a practical decision readers need to make and its consequence.',
  'Start with a short test readers can do today based on SOURCE EXCERPTS.',
];
const EN_CONTENT_FORMATS = [
  ['source_consequence', 'Start from one source finding and show its consequence in the reader\'s work.'],
  ['tradeoff', 'Compare two real choices and explain when each is useful.'],
  ['mini_case', 'Use a short teardown: visible problem, small decision, and evidence-based impact.'],
  ['checklist', 'Give 2-3 checks the reader can do today, not a theory list.'],
  ['misconception', 'Open with a common assumption and correct it with evidence and a real example.'],
  ['process_story', 'Use friction → step → practical lesson without claiming personal experience not in the source.'],
  ['evidence_opinion', 'Give a clear opinion, test it with one piece of evidence, and state one limit.'],
] as const;
const EN_CTA_MECHANISMS = [
  ['choice_ab', 'End with one easy A/B choice.'],
  ['field_experience', 'End with one specific question about practical experience.'],
  ['self_diagnosis', 'End with one short diagnostic question.'],
  ['counter_opinion', 'End with one relevant counter-opinion question.'],
] as const;

export function getContentStrategy(pillar: string, seed = '', variation = 0, locale: 'id' | 'en' = 'id'): ContentStrategy {
  const configuredPillar = getContentPillar(pillar);
  const strategyMap = locale === 'en' ? EN_STRATEGIES : STRATEGIES;
  const strategy = strategyMap[pillar] || (configuredPillar ? {
    label: configuredPillar.name,
    topicTag: configuredPillar.name,
    clusters: [[configuredPillar.name, `${configuredPillar.name} practical`, `how to use ${configuredPillar.name}`]],
  } : locale === 'en' ? EN_STRATEGIES.github : FALLBACK);
  const hookInstructions = locale === 'en' ? EN_HOOK_INSTRUCTIONS : HOOK_INSTRUCTIONS;
  const contentFormats = locale === 'en' ? EN_CONTENT_FORMATS : CONTENT_FORMATS;
  const ctaMechanisms = locale === 'en' ? EN_CTA_MECHANISMS : CTA_MECHANISMS;
  const safeVariation = Math.max(0, Math.floor(variation));
  const cluster = strategy.clusters[(stableIndex(`${pillar}:${seed}`, strategy.clusters.length) + safeVariation) % strategy.clusters.length];
  const hookIndex = (stableIndex(pillar, hookInstructions.length) + safeVariation) % hookInstructions.length;
  const format = contentFormats[(stableIndex(`${pillar}:format:${seed}`, contentFormats.length) + safeVariation) % contentFormats.length];
  const cta = ctaMechanisms[(stableIndex(`${pillar}:cta:${seed}`, ctaMechanisms.length) + safeVariation) % ctaMechanisms.length];
  return { label: strategy.label, topicTag: strategy.topicTag, keywords: cluster, hookInstruction: hookInstructions[hookIndex], hookMechanism: HOOK_MECHANISMS[hookIndex], contentFormat: format[0], formatInstruction: format[1], ctaMechanism: cta[0], ctaInstruction: cta[1] };
}

function stableIndex(value: string, length: number): number {
  let hash = 0;
  for (const char of value) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return hash % length;
}
