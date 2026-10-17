import type { DatabaseSync } from 'node:sqlite';
import { getDb } from './db';

export type CompositionLocale = 'id' | 'en';
export type CompositionPostType = 'any' | 'education' | 'promotion';
export type CompositionMode = 'standalone' | 'thread';

export interface ContentComposition {
  slug: string;
  name: string;
  enabled: boolean;
  locale: CompositionLocale;
  post_type: CompositionPostType;
  hook_rule: string;
  structure_rule: string;
  cta_rule: string;
  max_length: number;
  mode: CompositionMode;
  hashtag_policy: string;
  source_link_policy: string;
  prompt_text: string;
  position: number;
}

export const DEFAULT_CONTENT_COMPOSITIONS: ContentComposition[] = [
  composition('education', 'Education', 'education', 'Mulai dari temuan sumber atau masalah pembaca.', 'Hook → penjelasan → langkah praktis → sumber → satu pertanyaan pengalaman.'),
  composition('case-study', 'Case study', 'education', 'Mulai dari gejala konkret dan keputusan kecil.', 'Masalah → keputusan → dampak yang didukung sumber → batasan → pertanyaan.'),
  composition('checklist', 'Checklist', 'education', 'Mulai dari kesalahan yang bisa dicek hari ini.', 'Masalah → 2-3 cek praktis → sumber → pertanyaan diagnosis.'),
  composition('opinion', 'Opinion', 'education', 'Mulai dari trade-off atau asumsi yang perlu dikoreksi.', 'Pendapat → bukti sumber → batasan → tindakan → pertanyaan kontra.'),
  composition('soft-promotion', 'Soft promotion', 'promotion', 'Mulai dari masalah pembaca sebelum menyebut offer.', 'Masalah → edukasi singkat → offer relevan → alasan → pertanyaan.'),
  composition('product-update', 'Product update', 'any', 'Mulai dari perubahan yang berdampak pada pekerjaan pembaca.', 'Perubahan → siapa yang terbantu → cara pakai → sumber → pertanyaan.'),
].map((composition, position) => ({ ...composition, position }));

export function getContentCompositions(db: DatabaseSync = getDb(), enabledOnly = false): ContentComposition[] {
  try {
    const rows = db.prepare(`
      SELECT slug, name, enabled, locale, post_type, hook_rule, structure_rule, cta_rule,
        max_length, mode, hashtag_policy, source_link_policy, prompt_text, position
      FROM content_compositions
      ${enabledOnly ? 'WHERE enabled = 1' : ''}
      ORDER BY position ASC, slug ASC
    `).all() as Array<Record<string, unknown>>;
    return rows.map(toContentComposition);
  } catch {
    return DEFAULT_CONTENT_COMPOSITIONS.filter(composition => !enabledOnly || composition.enabled).map(composition => ({ ...composition }));
  }
}

export function getContentComposition(
  pillar: string,
  postType: 'education' | 'promotion',
  seed = '',
  locale: CompositionLocale = 'id',
  db: DatabaseSync = getDb(),
): ContentComposition {
  const candidates = getContentCompositions(db, true).filter(composition =>
    (composition.locale === locale || composition.locale === 'id')
      && (composition.post_type === 'any' || composition.post_type === postType),
  );
  const usable = candidates.length > 0 ? candidates : DEFAULT_CONTENT_COMPOSITIONS.filter(composition => composition.post_type === 'any' || composition.post_type === postType);
  return usable[stableIndex(`${pillar}:${postType}:${seed}`, usable.length)] || DEFAULT_CONTENT_COMPOSITIONS[0];
}

export function seedDefaultContentCompositions(db: DatabaseSync = getDb()): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO content_compositions
      (slug, name, enabled, locale, post_type, hook_rule, structure_rule, cta_rule, max_length, mode, hashtag_policy, source_link_policy, prompt_text, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const composition of DEFAULT_CONTENT_COMPOSITIONS) {
    insert.run(
      composition.slug,
      composition.name,
      composition.enabled ? 1 : 0,
      composition.locale,
      composition.post_type,
      composition.hook_rule,
      composition.structure_rule,
      composition.cta_rule,
      composition.max_length,
      composition.mode,
      composition.hashtag_policy,
      composition.source_link_policy,
      composition.prompt_text,
      composition.position,
    );
  }
}

export function isValidCompositionSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
}

function composition(slug: string, name: string, postType: CompositionPostType, hookRule: string, structureRule: string): ContentComposition {
  return {
    slug,
    name,
    enabled: true,
    locale: 'id',
    post_type: postType,
    hook_rule: hookRule,
    structure_rule: structureRule,
    cta_rule: 'Satu pertanyaan pengalaman yang natural; jangan meminta like, share, follow, atau komentar satu kata.',
    max_length: 500,
    mode: 'standalone',
    hashtag_policy: '1-3 hashtag relevan di akhir post',
    source_link_policy: 'Satu URL HTTPS canonical dari source di isi utama',
    prompt_text: '',
    position: 0,
  };
}

function toContentComposition(row: Record<string, unknown>): ContentComposition {
  return {
    slug: String(row.slug),
    name: String(row.name),
    enabled: Number(row.enabled) === 1,
    locale: row.locale === 'en' ? 'en' : 'id',
    post_type: row.post_type === 'promotion' || row.post_type === 'education' ? row.post_type : 'any',
    hook_rule: String(row.hook_rule || ''),
    structure_rule: String(row.structure_rule || ''),
    cta_rule: String(row.cta_rule || ''),
    max_length: Math.min(500, Math.max(1, Number(row.max_length) || 500)),
    mode: row.mode === 'thread' ? 'thread' : 'standalone',
    hashtag_policy: String(row.hashtag_policy || ''),
    source_link_policy: String(row.source_link_policy || ''),
    prompt_text: String(row.prompt_text || ''),
    position: Math.max(0, Number(row.position) || 0),
  };
}

function stableIndex(value: string, length: number): number {
  let hash = 0;
  for (const char of value) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return hash % length;
}
