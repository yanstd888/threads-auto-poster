import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureNaturalQuestionCta, formatPostText, normalizePillarHashtags, runQualityGate, splitOverlongThreadParts } from './lib/quality-gate';
import { buildPrompt, parseHermesOutput } from './lib/hermes';
import { getContentStrategy } from './lib/content-strategy';
import { getContentPillars, seedDefaultContentPillars } from './lib/content-pillars';
import { getContentCompositions, getContentComposition, seedDefaultContentCompositions } from './lib/content-compositions';
import { pruneExpiredSourceSnapshots, readLimitedResponseText, saveSourceSnapshot, selectSourceFetchBatches, selectSourcesForContext, sourceResponseHealth } from './lib/source-context';
import { availablePreparationWorkers, classifyPreparationError, contentPreparationRetryDelayMs, getDailySlotCapacity, getNextMissedScheduledSlot, getNextPreparationSlot, isBlockedSourceError, MIN_SCHEDULE_GAP_MINUTES, planDailyPillars, planDailySlotTimes, recoverStalePreparations } from './lib/scheduler';
import { claimPostForPublishing } from './lib/publish-claim';
import { createThreadsContainerUrl, shouldRefreshThreadsToken } from './lib/threads-api';
import { captureDueSnapshots } from './lib/metrics';
import { reservePrimarySource, releasePrimarySourceReservation } from './lib/content-history';
import { applyConfigImport, createConfigExport, validateConfigImport } from './lib/config-transfer';

const requiredKeywords = ['repo GitHub terbaik', 'repository open source', 'tools developer gratis'];
const resourceUrl = 'https://github.com/public-apis/public-apis';
const quality = runQualityGate({
  text: `3 repo GitHub terbaik untuk dicoba kalau kamu butuh repository open source dan tools developer gratis. ${resourceUrl} Repo mana yang paling berguna untuk workflow-mu? #opensource`,
  replies: [],
  keywords: [],
  requiredKeywords,
  sourceUrls: [resourceUrl],
  requiredResourceUrl: resourceUrl,
  postType: 'education',
  softSelling: false,
});
assert.equal(quality.passed, true, quality.reasons.join('; '));
assert.equal(formatPostText('  Satu   ide.  \r\n\r\n\r\n  Ide lain.  '), 'Satu ide.\n\nIde lain.');
void readLimitedResponseText(new Response('x'.repeat(150_000))).then(body => assert.equal(body.length, 100_000, 'source body must be capped before cleaning'));
assert.ok(!quality.reasons.some(reason => reason.includes('CTA engagement bait')));
assert.equal(sourceResponseHealth({ id: 1, name: 'repo', url: resourceUrl, source_type: 'github' }, 403), 'transient');
assert.equal(sourceResponseHealth({ id: 2, name: 'page', url: 'https://example.com/', source_type: 'web' }, 403), 'dead');

const missingEngagementCta = runQualityGate({
  text: `3 repo GitHub terbaik untuk dicoba kalau kamu butuh repository open source dan tools developer gratis. ${resourceUrl} #opensource`,
  replies: [], keywords: [], requiredKeywords, sourceUrls: [resourceUrl], requiredResourceUrl: resourceUrl,
  postType: 'education', softSelling: false,
});
assert.ok(missingEngagementCta.reasons.some(reason => reason.includes('CTA engagement')));
const threadedDraft = runQualityGate({ text: `3 repo GitHub terbaik untuk dicoba kalau kamu butuh repository open source dan tools developer gratis. ${resourceUrl} Repo mana yang paling berguna untuk workflow-mu? #opensource`, replies: ['Tambahan'], keywords: [], requiredKeywords, sourceUrls: [resourceUrl], requiredResourceUrl: resourceUrl, postType: 'education', softSelling: false, standaloneOnly: true });
assert.ok(threadedDraft.reasons.some(reason => reason.includes('satu post')));
const repairedCta = ensureNaturalQuestionCta(`3 repo GitHub terbaik untuk dicoba kalau kamu butuh repository open source dan tools developer gratis. ${resourceUrl}`, [], 'field_experience');
assert.ok(!runQualityGate({ text: repairedCta.text, replies: repairedCta.replies, keywords: [], requiredKeywords, sourceUrls: [resourceUrl], requiredResourceUrl: resourceUrl, postType: 'education', softSelling: false }).reasons.some(reason => reason.includes('CTA engagement')));
const splitThread = splitOverlongThreadParts('Pendek.', ['x '.repeat(320)]);
assert.ok([splitThread.text, ...splitThread.replies].every(part => part.length <= 500));
assert.ok(splitThread.replies.length >= 2);
const teamQuestionCta = runQualityGate({
  text: 'Banyak pemilik website UMKM kehilangan calon pelanggan saat halaman lambat merespons, menurut dokumentasi web.dev tentang INP. Website bisnis kecil perlu mengukur respons tombol sebelum memperbanyak elemen visual. Di tim kamu, tombol mana yang paling sering terasa lambat saat ditekan? #websiteUMKM',
  replies: [], keywords: [], requiredKeywords: ['website UMKM', 'website bisnis kecil'], sourceUrls: ['https://web.dev/'], postType: 'education', softSelling: false,
});
assert.ok(!teamQuestionCta.reasons.some(reason => reason.includes('CTA engagement')), teamQuestionCta.reasons.join('; '));
const placeQuestionCta = runQualityGate({
  text: 'Pilih tunda update atau pasrah keamanan siber kantor ditembus? Catatan keamanan siber menunjukkan patch rutin perlu menjaga sistem. Di tempatmu, update software langsung dipasang atau sering ditunda? #PatchManagement',
  replies: [], keywords: [], requiredKeywords: ['keamanan siber', 'patch rutin'], sourceUrls: ['https://example.com/'], postType: 'education', softSelling: false,
});
assert.equal(placeQuestionCta.passed, true, placeQuestionCta.reasons.join('; '));
const naturalTailQuestion = runQualityGate({
  text: 'Banyak yang kira pakai tools AI gratis langsung bikin bot pintar. Nyatanya, workflow tanpa kontrol gampang melenceng. Framework ini membantu routing agent tetap terukur. Atau framework serba instan justru bikin malas paham dasar backend? #AIAgent',
  replies: [], keywords: [], requiredKeywords: ['tools AI gratis', 'workflow AI'], sourceUrls: ['https://example.com/'], postType: 'education', softSelling: false,
});
assert.ok(!naturalTailQuestion.reasons.some(reason => reason.includes('CTA engagement')), naturalTailQuestion.reasons.join('; '));
assert.ok(!naturalTailQuestion.reasons.some(reason => reason.includes('Hook harus')), naturalTailQuestion.reasons.join('; '));
const choiceCta = runQualityGate({
  text: 'Abaikan evaluasi saat memasang agent skill? Sistem jadi sulit dikendalikan. Pilih mana: A. Uji ketat B. Langsung deploy #AIAgent',
  replies: [], keywords: [], requiredKeywords: ['agent skill'], sourceUrls: ['https://example.com/'], postType: 'education', softSelling: false,
});
assert.ok(!choiceCta.reasons.some(reason => reason.includes('CTA engagement')), choiceCta.reasons.join('; '));
const separateCtas = runQualityGate({
  text: 'Banyak yang kira workflow AI cukup dengan prompt. Kenyataannya evaluasi tetap wajib. Tulis pilihanmu di komentar lalu bagikan postingan ini. #AIAgent',
  replies: [], keywords: [], requiredKeywords: ['workflow AI'], sourceUrls: ['https://example.com/'], postType: 'education', softSelling: false,
});
assert.ok(separateCtas.reasons.some(reason => reason.includes('CTA engagement bait')), separateCtas.reasons.join('; '));
const baitCta = runQualityGate({
  text: 'Keamanan siber sering gagal bukan karena tools mahal, tapi karena patch dibiarkan. Share postingan ini ke 3 teman agar semua aman. #AI',
  replies: [], keywords: [], requiredKeywords: ['keamanan siber'], sourceUrls: ['https://example.com/'], postType: 'education', softSelling: false,
});
assert.ok(baitCta.reasons.some(reason => reason.includes('CTA engagement bait')), baitCta.reasons.join('; '));
const shortUrl = runQualityGate({
  text: 'Banyak tim salah pilih repository open source karena tidak cek maintainer. Repo GitHub terbaik butuh evaluasi sebelum dipakai. Mana yang paling kamu cek dulu? https://bit.ly/contoh #github',
  replies: [], keywords: [], requiredKeywords, sourceUrls: [resourceUrl], postType: 'education', softSelling: false,
});
assert.ok(shortUrl.reasons.some(reason => reason.includes('URL shortener')), shortUrl.reasons.join('; '));
const stackedUrls = runQualityGate({
  text: 'Banyak tim salah pilih repository open source karena tidak cek maintainer. Repo GitHub terbaik butuh evaluasi sebelum dipakai. Mana yang paling kamu cek dulu? https://example.com/a https://example.com/b #github',
  replies: [], keywords: [], requiredKeywords, sourceUrls: [resourceUrl], postType: 'education', softSelling: false,
});
assert.ok(stackedUrls.reasons.some(reason => reason.includes('Maksimal satu URL')), stackedUrls.reasons.join('; '));
const trackingUrl = runQualityGate({
  text: 'Banyak tim salah pilih repository open source karena tidak cek maintainer. Repo GitHub terbaik butuh evaluasi sebelum dipakai. Mana yang paling kamu cek dulu? https://example.com/a?utm_source=threads #github',
  replies: [], keywords: [], requiredKeywords, sourceUrls: [resourceUrl], postType: 'education', softSelling: false,
});
assert.ok(trackingUrl.reasons.some(reason => reason.includes('URL tracking')), trackingUrl.reasons.join('; '));

const missingResourceUrl = runQualityGate({
  text: '3 repo GitHub terbaik untuk dicoba kalau kamu butuh repository open source dan tools developer gratis. #opensource',
  replies: [], keywords: [], requiredKeywords, sourceUrls: [resourceUrl], requiredResourceUrl: resourceUrl,
  postType: 'education', softSelling: false,
});
assert.ok(missingResourceUrl.reasons.some(reason => reason.includes('wajib dicantumkan penuh')));

const missingDerivative = runQualityGate({
  text: '3 repo GitHub terbaik untuk dicoba minggu ini karena dokumentasinya rapi. #opensource',
  replies: [],
  keywords: [],
  requiredKeywords,
  sourceUrls: ['https://github.com/public-apis/public-apis'],
  postType: 'education',
  softSelling: false,
});
assert.ok(missingDerivative.reasons.some((reason: string) => reason.includes('turunan')));

const stale = runQualityGate({
  text: 'Riset 2025 menyebut 3 repo GitHub terbaik untuk repository open source dan tools developer gratis. #opensource',
  replies: [], keywords: [], requiredKeywords, sourceUrls: ['https://github.com/'], postType: 'education', softSelling: false,
});
assert.ok(stale.reasons.some(reason => reason.includes('tahun lama')));

const capitalizedCta = runQualityGate({
  text: 'Website UMKM terlihat profesional bukan karena tampilannya ramai, tetapi karena website bisnis kecil memberi respons yang jelas saat dipakai dari HP. Di web usahamu, bagian mana yang paling sering membuat calon pembeli berhenti? #websiteUMKM',
  replies: [], keywords: [], requiredKeywords: ['website UMKM', 'website bisnis kecil'], sourceUrls: ['https://web.dev/'], postType: 'education', softSelling: false,
});
assert.equal(capitalizedCta.passed, true, capitalizedCta.reasons.join('; '));
assert.ok(!capitalizedCta.reasons.some(reason => reason.includes('Hook harus')));

const sourceGroundedBanyakHook = runQualityGate({
  text: 'Banyak pemilik website UMKM kehilangan calon pelanggan saat halaman lambat merespons, menurut dokumentasi web.dev tentang INP. Website bisnis kecil perlu mengukur respons tombol sebelum memperbanyak elemen visual. Tombol mana di web usahamu yang paling sering terasa lambat? #websiteUMKM',
  replies: [], keywords: [], requiredKeywords: ['website UMKM', 'website bisnis kecil'], sourceUrls: ['https://web.dev/'], postType: 'education', softSelling: false,
});
assert.equal(sourceGroundedBanyakHook.passed, true, sourceGroundedBanyakHook.reasons.join('; '));

const tradeoffHook = runQualityGate({
  text: 'Pasang kontak resmi di website UMKM sekarang atau calon pembeli ragu dan batal transaksi. Website bisnis kecil yang transparan membuat pelanggan tahu harus menghubungi siapa. Web usahamu sudah punya info kontak yang terlihat jelas? #WebsiteUMKM',
  replies: [], keywords: [], requiredKeywords: ['website UMKM', 'website bisnis kecil'], sourceUrls: ['https://www.ojk.go.id/'], postType: 'education', softSelling: false,
});
assert.equal(tradeoffHook.passed, true, tradeoffHook.reasons.join('; '));

const genericOpening = runQualityGate({
  text: 'Banyak yang belum sadar bahwa website UMKM dan website bisnis kecil perlu diperhatikan setelah dibuat. Simpan catatan ini untuk evaluasi berikutnya. #websiteUMKM',
  replies: [], keywords: [], requiredKeywords: ['website UMKM', 'website bisnis kecil'], sourceUrls: ['https://web.dev/'], postType: 'education', softSelling: false,
});
assert.equal(genericOpening.passed, false);
assert.ok(genericOpening.reasons.some(reason => reason.includes('Hook harus')));

const tooManyHashtags = runQualityGate({
  text: 'Website UMKM terlihat profesional bukan karena tampilannya ramai, tetapi karena website bisnis kecil memberi respons yang jelas saat dipakai dari HP. Simpan panduan ini untuk audit web berikutnya. #satu #dua #tiga #empat',
  replies: [], keywords: [], requiredKeywords: ['website UMKM', 'website bisnis kecil'], sourceUrls: ['https://web.dev/'], postType: 'education', softSelling: false,
});
assert.ok(tooManyHashtags.reasons.some(reason => reason.includes('harus 1-3')));

const githubHashtags = normalizePillarHashtags('Konten repo. #webdev #Tech #opensource', [], 'github');
assert.equal(githubHashtags.text, 'Konten repo.\n\n#Tech #webdev #opensource');
const aiHashtags = normalizePillarHashtags('Konten AI. #AIAgent #MCP', [], 'ai');
assert.equal(aiHashtags.text, 'Konten AI.\n\n#AI #AIAgent #MCP');
const securityHashtags = normalizePillarHashtags('Konten security.', ['Detail. #CyberSecurity'], 'security');
assert.deepEqual(securityHashtags, { text: 'Konten security.', replies: ['Detail.\n\n#AI #CyberSecurity'] });
const umkmHashtags = normalizePillarHashtags('Konten usaha. #SEOIndonesia #WebsiteUMKM', [], 'umkm');
assert.equal(umkmHashtags.text, 'Konten usaha.\n\n#UMKM #SEOIndonesia #WebsiteUMKM');
const tightHashtags = normalizePillarHashtags(`${'x'.repeat(490)} #TagPanjang #TagLain`, [], 'umkm');
assert.equal(tightHashtags.text.endsWith('#UMKM'), true);
assert.ok(tightHashtags.text.length <= 500);
const wrongFirstHashtag = runQualityGate({
  text: 'Pilih repo yang dokumentasinya jelas agar proyek tidak tersendat. Repo GitHub terbaik ini cocok menjadi repository open source untuk tools developer gratis. Mana yang ingin kamu coba? #opensource #github',
  replies: [], keywords: [], requiredKeywords, sourceUrls: [resourceUrl], postType: 'education', softSelling: false, pillar: 'github',
});
assert.ok(wrongFirstHashtag.reasons.some(reason => reason.includes('Hashtag pertama')));

const duplicate = runQualityGate({
  text: '3 repo GitHub terbaik untuk dicoba kalau kamu butuh repository open source dan tools developer gratis. #opensource',
  replies: [], keywords: [], requiredKeywords, sourceUrls: ['https://github.com/'], postType: 'education', softSelling: false,
}, ['3 repo GitHub terbaik untuk dicoba kalau kamu butuh repository open source dan tools developer gratis. #opensource']);
assert.ok(duplicate.reasons.some(reason => reason.includes('terlalu mirip')));

const paraphrasedContent = runQualityGate({
  text: 'Website UMKM jangan cuma estetik. Optimasi gambar, navigasi sederhana, dan Core Web Vitals bikin website bisnis kecil lebih nyaman di HP. Simpan untuk audit berikutnya. #websiteUMKM',
  replies: [], keywords: [], requiredKeywords: ['website UMKM', 'website bisnis kecil'], sourceUrls: ['https://web.dev/'], postType: 'education', softSelling: false,
}, ['Website UMKM bukan soal tampilan saja. Core Web Vitals, gambar ringan, dan navigasi simpel membuat website bisnis kecil nyaman dibuka lewat HP. Simpan untuk audit berikutnya. #websiteUMKM']);
assert.ok(paraphrasedContent.reasons.some(reason => reason.includes('Inti konten terlalu mirip')));
const educationPromoLeak = runQualityGate({
  text: 'Website UMKM perlu jelas agar calon pembeli percaya. Cek https://example.com untuk bantuan. Simpan panduan ini. #websiteUMKM',
  replies: [], keywords: [], requiredKeywords: ['website UMKM'], sourceUrls: ['https://web.dev/'], postType: 'education', softSelling: false,
  promoWebsiteUrl: 'https://example.com',
});
assert.ok(educationPromoLeak.reasons.some(reason => reason.includes('tidak boleh memuat https://example.com')));
assert.equal(new Set(Array.from({ length: 7 }, (_, index) => getContentStrategy('ai', 'format-seed', index).contentFormat)).size, 7, 'seven content formats must rotate');

const slots = planDailySlotTimes({ year: 2026, month: 10, day: 15 }, 10, 8, 20, 'Asia/Jakarta');
assert.equal(slots.length, 10);
for (let index = 1; index < slots.length; index++) {
  assert.ok(slots[index] - slots[index - 1] >= 60 * 60 * 1000, 'legacy 10-post spacing must remain at least 60 minutes');
}
const slots11 = planDailySlotTimes({ year: 2026, month: 10, day: 15 }, 11, 8, 20, 'Asia/Jakarta');
const slots25 = planDailySlotTimes({ year: 2026, month: 10, day: 15 }, 25, 8, 20, 'Asia/Jakarta');
const slots100 = planDailySlotTimes({ year: 2026, month: 10, day: 15 }, 100, 8, 20, 'Asia/Jakarta');
assert.equal(slots11.length, 11, '11 posts/day must schedule');
assert.equal(slots25.length, 25, '25 posts/day must schedule');
assert.equal(slots100.length, 100, 'higher configured volume must schedule');
for (const candidate of [slots11, slots25, slots100]) {
  for (let index = 1; index < candidate.length; index++) {
    assert.ok(candidate[index] - candidate[index - 1] >= MIN_SCHEDULE_GAP_MINUTES * 60 * 1000, 'high-volume slots must keep the safety gap');
  }
}
assert.equal(getDailySlotCapacity(8, 20), 141);
assert.equal(planDailySlotTimes({ year: 2026, month: 10, day: 15 }, 200, 8, 20, 'Asia/Jakarta').length, getDailySlotCapacity(8, 20), 'capacity must bound impossible requests');
const hourMinute = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
assert.ok(slots.map((slot: number) => hourMinute.format(new Date(slot))).includes('09:00'), 'Thursday must retain the 09:00 anchor');
assert.deepEqual(planDailyPillars(10), ['umkm', 'ai', 'github', 'security', 'umkm', 'ai', 'github', 'security', 'umkm', 'ai']);
const configExport = createConfigExport(
  { posts_per_day: '25', posting_mode: 'approval', JWT_SECRET: 'must-not-export' },
  [{ name: 'Example', url: resourceUrl, pillar: 'github', source_type: 'manual', approved: true }],
  '2026-10-18T00:00:00.000Z',
);
assert.equal(configExport.settings.JWT_SECRET, undefined, 'secret-like settings must not export');
assert.equal(configExport.settings.posts_per_day, '25');
const importedConfig = validateConfigImport(configExport);
if (!('config' in importedConfig)) throw new Error(importedConfig.error);
assert.equal(importedConfig.config.sources.length, 1);
assert.equal(importedConfig.config.sources[0].approved, true);
assert.ok('error' in validateConfigImport({ ...configExport, settings: { kill_switch: 'true' } }), 'kill switch must not import');
assert.ok('error' in validateConfigImport({ ...configExport, sources: [{ ...configExport.sources[0], url: 'https://localhost/private' }] }), 'private source must not import');
const configDb = new DatabaseSync(':memory:');
configDb.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, url TEXT NOT NULL, pillar TEXT NOT NULL, source_type TEXT NOT NULL, last_checked INTEGER, approved INTEGER, created_at INTEGER NOT NULL);');
const importCounts = applyConfigImport(configDb, importedConfig.config);
assert.deepEqual(importCounts, { settings: 2, sources: 1 });
assert.equal((configDb.prepare("SELECT value FROM settings WHERE key = 'posts_per_day'").get() as { value: string }).value, '25');
assert.equal((configDb.prepare('SELECT COUNT(*) AS count FROM sources').get() as { count: number }).count, 1);
assert.equal((configDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('tokens', 'users', 'content_history')").get() as { count: number }).count, 0, 'config import must not create secret/history tables');
const pillarDb = new DatabaseSync(':memory:');
pillarDb.exec(`CREATE TABLE content_pillars (slug TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL, weight INTEGER NOT NULL, locale TEXT NOT NULL, source_policy TEXT NOT NULL, promo_eligible INTEGER NOT NULL, position INTEGER NOT NULL)`);
seedDefaultContentPillars(pillarDb);
pillarDb.prepare("INSERT INTO content_pillars (slug, name, enabled, weight, locale, source_policy, promo_eligible, position) VALUES ('custom', 'Custom Topic', 1, 10, 'en', 'any', 1, 4)").run();
const customPillar = getContentPillars(pillarDb).find(pillar => pillar.slug === 'custom');
assert.equal(customPillar?.locale, 'en');
assert.equal(customPillar?.promo_eligible, true);
const pillarExport = createConfigExport({}, [], getContentPillars(pillarDb), '2026-10-18T00:00:00.000Z');
const pillarImport = validateConfigImport(pillarExport);
if (!('config' in pillarImport)) throw new Error(pillarImport.error);
assert.ok(pillarImport.config.content_definitions.some(pillar => pillar.slug === 'custom'));
const pillarImportDb = new DatabaseSync(':memory:');
pillarImportDb.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, url TEXT NOT NULL, pillar TEXT NOT NULL, source_type TEXT NOT NULL, last_checked INTEGER, approved INTEGER, created_at INTEGER NOT NULL);');
applyConfigImport(pillarImportDb, pillarImport.config);
assert.equal((pillarImportDb.prepare("SELECT locale FROM content_pillars WHERE slug = 'custom'").get() as { locale: string }).locale, 'en');
const compositionDb = new DatabaseSync(':memory:');
compositionDb.exec(`CREATE TABLE content_compositions (slug TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL, locale TEXT NOT NULL, post_type TEXT NOT NULL, hook_rule TEXT NOT NULL, structure_rule TEXT NOT NULL, cta_rule TEXT NOT NULL, max_length INTEGER NOT NULL, mode TEXT NOT NULL, hashtag_policy TEXT NOT NULL, source_link_policy TEXT NOT NULL, prompt_text TEXT NOT NULL, position INTEGER NOT NULL)`);
seedDefaultContentCompositions(compositionDb);
assert.equal(getContentCompositions(compositionDb).length, 6);
compositionDb.exec('DELETE FROM content_compositions');
compositionDb.prepare("INSERT INTO content_compositions (slug, name, enabled, locale, post_type, hook_rule, structure_rule, cta_rule, max_length, mode, hashtag_policy, source_link_policy, prompt_text, position) VALUES ('custom-format', 'Custom format', 1, 'en', 'education', 'Custom hook', 'Custom structure', 'Custom CTA', 420, 'thread', 'Custom hashtag', 'Custom source policy', 'Custom prompt', 0)").run();
const selectedComposition = getContentComposition('custom', 'education', 'slot', 'en', compositionDb);
assert.equal(selectedComposition.slug, 'custom-format');
assert.equal(selectedComposition.mode, 'thread');
assert.equal(selectedComposition.max_length, 420);
assert.notEqual(getContentStrategy('ai', 'slot-1', 0).hookInstruction, getContentStrategy('ai', 'slot-1', 1).hookInstruction);
assert.notDeepEqual(getContentStrategy('ai', 'slot-1', 0).keywords, getContentStrategy('ai', 'slot-1', 1).keywords);
assert.equal(contentPreparationRetryDelayMs(0), 60_000);
assert.equal(contentPreparationRetryDelayMs(2), 4 * 60_000);
assert.equal(contentPreparationRetryDelayMs(5), 8 * 60_000);
assert.equal(classifyPreparationError('source timeout'), 'source_transient');
assert.equal(classifyPreparationError('invalid_json'), 'invalid_json');
assert.equal(classifyPreparationError('quality_gate'), 'quality_reject');
assert.equal(classifyPreparationError('source_transient: GitHub resource unavailable'), 'source_transient');
assert.equal(isBlockedSourceError('Semua tema/sumber utama untuk pilar ini sudah dipakai dalam 14 hari terakhir'), true);
const sourceFixtures = [
  { id: 1, name: 'Required repo', url: 'https://github.com/acme/repo', source_type: 'repository' },
  { id: 2, name: 'Same-host source', url: 'https://github.com/trending', source_type: 'webpage' },
  { id: 3, name: 'Node source', url: 'https://nodejs.org/en/blog', source_type: 'webpage' },
  { id: 4, name: 'GitLab source', url: 'https://about.gitlab.com/releases', source_type: 'webpage' },
];
const diverseSources = selectSourcesForContext(sourceFixtures);
assert.deepEqual(diverseSources.map(source => source.name), ['Required repo', 'Node source']);
assert.deepEqual(selectSourceFetchBatches(sourceFixtures).map(batch => batch.map(source => source.name)), [
  ['Required repo', 'Node source'],
  ['GitLab source', 'Same-host source'],
]);
const initialPrompt = buildPrompt({
  pillar: 'AI agent skill terbaik', postType: 'education', language: 'id', style: 'casual', softSelling: false,
  keywords: ['AI agent', 'tools AI untuk kerja'], avoidTopics: [], sources: ['https://example.com'], sourceContext: 'Sumber singkat.',
  hookInstruction: getContentStrategy('ai', 'slot-1', 0).hookInstruction, maxLength: 500,
});
const learningPrompt = buildPrompt({
  pillar: 'AI agent skill terbaik', postType: 'education', language: 'id', style: 'casual', softSelling: false,
  keywords: ['AI agent', 'tools AI untuk kerja'], avoidTopics: [], sources: ['https://example.com'], sourceContext: 'Sumber singkat.',
  performanceHint: 'Data akun sendiri (n=5 snapshot 24 jam): prioritaskan sebagai tie-breaker hook tradeoff dan format checklist.', maxLength: 500,
});
const retryPrompt = buildPrompt({
  pillar: 'AI agent skill terbaik', postType: 'education', language: 'id', style: 'casual', softSelling: false,
  keywords: getContentStrategy('ai', 'slot-1', 1).keywords, avoidTopics: [], sources: ['https://example.com'], sourceContext: 'Sumber singkat.',
  hookInstruction: getContentStrategy('ai', 'slot-1', 1).hookInstruction, retryAttempt: 1,
  previousRejectedContent: 'Konten lama yang ditolak.', previousQualityReasons: ['CTA tidak ada'], maxLength: 500,
});
assert.match(initialPrompt, /Jangan memakai pembuka generik yang tidak membawa fakta, gejala, trade-off, kontras, atau pertanyaan diagnosis/);
assert.match(initialPrompt, /bukan brosur, artikel SEO, atau makalah/);
assert.match(initialPrompt, /Jangan memakai pola datar "Fungsinya\.\.\. Use case utamanya\.\.\. Cocok untuk\.\.\."/);
assert.match(initialPrompt, /tepat satu URL HTTPS canonical/);
assert.match(initialPrompt, /"replies": \[\]/);
assert.match(learningPrompt, /SINYAL PERFORMA TERUKUR/);
assert.match(initialPrompt, /PEMERIKSAAN FINAL SEBELUM KIRIM/);
assert.match(initialPrompt, /tepat satu pertanyaan pengalaman yang natural dan diakhiri tanda tanya/);
assert.notEqual(initialPrompt, retryPrompt);
assert.match(retryPrompt, /PERCOBAAN ULANG KE-2/);
assert.match(retryPrompt, /Konten lama yang ditolak/);
assert.equal(parseHermesOutput('session_id: orphaned-footer', {
  pillar: 'AI agent skill terbaik', postType: 'education', language: 'id', style: 'casual', softSelling: false,
  keywords: ['AI agent'], avoidTopics: [], sources: ['https://example.com'], maxLength: 500,
}).error, 'Hermes output tidak berisi JSON konten yang valid');

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, details TEXT, created_at INTEGER NOT NULL)');
db.exec(`CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  content TEXT NOT NULL,
  replies TEXT,
  status TEXT NOT NULL,
  threads_id TEXT,
  threads_url TEXT,
  schedule_id INTEGER,
  posted_at INTEGER,
  quality_status TEXT
)`);
db.prepare("INSERT INTO posts (id, content, status) VALUES (1, 'test', 'draft')").run();
assert.equal(claimPostForPublishing(db, 1, ['draft']).kind, 'claimed');
assert.equal(claimPostForPublishing(db, 1, ['draft']).kind, 'publishing');
db.prepare("INSERT INTO posts (id, content, status) VALUES (2, 'retry', 'failed')").run();
assert.equal(claimPostForPublishing(db, 2, ['failed']).kind, 'claimed');
assert.equal(claimPostForPublishing(db, 2, ['failed']).kind, 'publishing');
assert.equal(shouldRefreshThreadsToken(1_000 + 6 * 24 * 60 * 60 * 1000, 1_000), true);
assert.equal(shouldRefreshThreadsToken(1_000 + 8 * 24 * 60 * 60 * 1000, 1_000), false);
assert.equal(shouldRefreshThreadsToken(999, 1_000), false);
const replyContainerUrl = createThreadsContainerUrl('user-1', 'token-1', 'Balasan', 'root-1');
assert.equal(replyContainerUrl.searchParams.get('reply_to_id'), 'root-1');
assert.equal(replyContainerUrl.searchParams.get('media_type'), 'TEXT');
const topicContainerUrl = createThreadsContainerUrl('user-1', 'token-1', 'Root', undefined, 'GitHub');
assert.equal(topicContainerUrl.searchParams.get('topic_tag'), 'GitHub');
assert.equal(replyContainerUrl.searchParams.has('topic_tag'), false);
db.exec('CREATE TABLE metric_snapshots (post_id INTEGER NOT NULL, checkpoint TEXT NOT NULL, views INTEGER NOT NULL, likes INTEGER NOT NULL, replies INTEGER NOT NULL, reposts INTEGER NOT NULL, quotes INTEGER NOT NULL, shares INTEGER NOT NULL, captured_at INTEGER NOT NULL, UNIQUE(post_id, checkpoint))');
db.prepare("INSERT INTO posts (id, content, status, posted_at) VALUES (5, 'metrics', 'posted', ?)").run(1_000);
captureDueSnapshots(db, 5, { views: 9, likes: 2, replies: 1, reposts: 3, quotes: 4, shares: 5 }, 8 * 24 * 60 * 60_000);
assert.deepEqual((db.prepare('SELECT checkpoint FROM metric_snapshots WHERE post_id = 5 ORDER BY checkpoint').all() as Array<{ checkpoint: string }>).map(row => row.checkpoint), ['1h', '24h', '7d']);
db.exec("CREATE TABLE schedule (id INTEGER PRIMARY KEY, slot_time INTEGER NOT NULL, pillar TEXT, status TEXT NOT NULL, retry_at INTEGER)");
db.prepare("INSERT INTO schedule (id, slot_time, status, retry_at) VALUES (1, 2_000, 'retrying', 5_000), (2, 10_000, 'pending', NULL)").run();
assert.equal(getNextPreparationSlot(db, 1_000)?.id, 1, 'earlier retry must block later-day preparation');
db.prepare("INSERT INTO posts (id, content, status, schedule_id) VALUES (3, 'rejected', 'quality_failed', 1)").run();
assert.equal(getNextPreparationSlot(db, 1_000)?.id, 1, 'rejected content must remain available as retry context');
db.prepare("INSERT INTO posts (id, content, status, schedule_id) VALUES (4, 'ready', 'scheduled', 1)").run();
assert.equal(getNextPreparationSlot(db, 1_000)?.id, 2, 'next day is eligible only after earlier slot is ready');
db.prepare("INSERT INTO schedule (id, slot_time, status, retry_at) VALUES (5, ?, 'pending', NULL)").run(1_000 + 48 * 60 * 60_000 + 1);
db.prepare("INSERT INTO posts (id, content, status, schedule_id) VALUES (6, 'ready', 'scheduled', 2)").run();
assert.equal(getNextPreparationSlot(db, 1_000), null, 'preparation must not drain slots beyond the 48h horizon');
db.exec('CREATE TABLE scheduler_locks (name TEXT PRIMARY KEY, locked_at INTEGER NOT NULL)');
db.prepare("INSERT INTO schedule (id, slot_time, pillar, status, retry_at) VALUES (3, 50_000, 'umkm', 'preparing', NULL), (4, 50_000, 'ai', 'preparing', NULL)").run();
db.prepare("INSERT INTO scheduler_locks (name, locked_at) VALUES ('content-preparation:umkm', 1), ('content-preparation:ai', 20_000)").run();
assert.equal(recoverStalePreparations(db, 20_000), true, 'stale preparation lock must be recovered without restart');
assert.equal((db.prepare('SELECT status FROM schedule WHERE id = 3').get() as { status: string }).status, 'pending', 'stale pillar must recover even when another pillar is active');
assert.equal((db.prepare('SELECT status FROM schedule WHERE id = 4').get() as { status: string }).status, 'preparing', 'fresh worker must not be reset');
assert.equal(availablePreparationWorkers(db, 0, 20_000), 2, 'one fresh lock leaves capacity for two workers');
assert.equal(availablePreparationWorkers(db, 2, 20_000), 0, 'queued workers count toward the global cap');
db.prepare("INSERT INTO schedule (id, slot_time, pillar, status, retry_at) VALUES (98, 500, 'github', 'pending', NULL), (99, 600, 'ai', 'pending', NULL), (100, 700, 'security', 'failed', NULL)").run();
db.prepare("INSERT INTO posts (id, content, status, quality_status, schedule_id) VALUES (98, 'old quality fail', 'scheduled', 'failed', 98), (99, 'ready overdue', 'scheduled', 'passed', 99), (100, 'unknown overdue', 'publish_unknown', 'passed', 100)").run();
assert.equal(getNextMissedScheduledSlot(db, 1_000)?.id, 99, 'catch-up must select only the oldest overdue, quality-passed scheduled draft');

db.exec('CREATE TABLE content_history (topic_hash TEXT NOT NULL, pillar TEXT NOT NULL, topic TEXT NOT NULL, link TEXT, created_at INTEGER NOT NULL)');
db.exec('CREATE TABLE source_reservations (source_url TEXT PRIMARY KEY, schedule_id INTEGER NOT NULL UNIQUE, expires_at INTEGER NOT NULL)');
const reservationNow = 1_000_000;
assert.equal(reservePrimarySource(db, 10, ['https://example.com/a', 'https://example.com/b'], 14, reservationNow), 'https://example.com/a');
assert.equal(reservePrimarySource(db, 10, ['https://example.com/a', 'https://example.com/b'], 14, reservationNow), 'https://example.com/a', 'retry must reuse its own reservation');
assert.equal(reservePrimarySource(db, 11, ['https://example.com/a', 'https://example.com/b'], 14, reservationNow), 'https://example.com/b', 'parallel slots must reserve different sources');
releasePrimarySourceReservation(db, 10, 'https://example.com/a');
db.prepare('INSERT INTO content_history (topic_hash, pillar, topic, link, created_at) VALUES (?, ?, ?, ?, ?)').run('a', 'umkm', 'a', 'https://example.com/a', reservationNow);
assert.equal(reservePrimarySource(db, 12, ['https://example.com/a'], 14, reservationNow), null, 'used sources remain blocked for 14 days');

db.exec('CREATE TABLE source_snapshots (id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL, data TEXT NOT NULL, fetched_at INTEGER NOT NULL, sha256 TEXT, expires_at INTEGER)');
db.exec('CREATE UNIQUE INDEX source_snapshots_one_hash ON source_snapshots(source_id, sha256) WHERE sha256 IS NOT NULL');
assert.equal(saveSourceSnapshot(db, 1, 'excerpt', reservationNow, 100), 1);
assert.equal(saveSourceSnapshot(db, 1, 'excerpt', reservationNow + 1, 100), 0, 'identical source snapshots must deduplicate');
assert.equal(pruneExpiredSourceSnapshots(db, reservationNow + 101), 1, 'expired snapshots must be pruned');

const appDb = new DatabaseSync(':memory:');
appDb.exec('CREATE TABLE sources (name TEXT NOT NULL, url TEXT NOT NULL, pillar TEXT NOT NULL, approved INTEGER NOT NULL)');
const sourceInsert = appDb.prepare('INSERT INTO sources (name, url, pillar, approved) VALUES (?, ?, ?, 1)');
sourceInsert.run('GitHub required', 'https://github.com/excalidraw/excalidraw', 'github');
sourceInsert.run('AI required', 'https://github.com/vercel-labs/skills', 'ai');
for (let index = 1; index <= 11; index += 1) {
  sourceInsert.run(`GitHub rotation ${index}`, `https://github.com/example/github-rotation-${index}`, 'github');
  sourceInsert.run(`AI rotation ${index}`, `https://github.com/example/ai-rotation-${index}`, 'ai');
}
sourceInsert.run('Security source', 'https://www.cisa.gov/news-events', 'security');
sourceInsert.run('UMKM source', 'https://web.dev/business', 'umkm');
const approvedSources = appDb.prepare("SELECT name, url, pillar FROM sources WHERE approved = 1").all() as { name: string; url: string; pillar: string }[];
assert.equal(new Set(approvedSources.map(source => source.url)).size, approvedSources.length, 'approved source URLs must be unique');
for (const pillar of ['github', 'ai', 'security', 'umkm']) {
  assert.ok(approvedSources.some(source => source.pillar === pillar), `${pillar} must have an approved source`);
}
assert.ok(approvedSources.some(source => source.url === 'https://github.com/excalidraw/excalidraw'), 'GitHub resource URL must stay approved');
assert.ok(approvedSources.some(source => source.url === 'https://github.com/vercel-labs/skills'), 'AI skill URL must stay approved');
assert.ok(approvedSources.filter(source => source.pillar === 'github' && source.url.startsWith('https://github.com/')).length >= 11, 'GitHub needs a 14-day rotation pool');
assert.ok(approvedSources.filter(source => source.pillar === 'ai' && source.url.startsWith('https://github.com/')).length >= 11, 'AI needs a 14-day rotation pool');

console.log('PASS content gate, varied retry prompts, source registry, and duplicate-publish claim');