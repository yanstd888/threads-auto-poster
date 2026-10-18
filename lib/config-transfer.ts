import type { DatabaseSync } from 'node:sqlite';
import { EXPORTABLE_SETTING_KEYS, validateScheduleWindow, validateSettingValue } from './settings-validation';
import { isSafeSourceUrl } from './source-url';
import { isValidPillarSlug, isValidPillarSourcePolicy, normalizeContentPillarWeights, type PillarLocale } from './content-pillars';
import { isValidCompositionSlug, type ContentComposition } from './content-compositions';

export const CONFIG_SCHEMA_VERSION = 1;
export const CONFIG_FORMAT = 'threads-auto-poster-config';

export interface ConfigSource {
  name: string;
  url: string;
  pillar: string;
  source_type: string;
  approved: boolean;
}

export interface ConfigPillar {
  slug: string;
  name: string;
  enabled: boolean;
  weight: number;
  locale: PillarLocale;
  source_policy: 'any' | 'github_repository';
  promo_eligible: boolean;
  position: number;
}

export type ConfigComposition = ContentComposition;

export interface ConfigExport {
  format: typeof CONFIG_FORMAT;
  schema_version: typeof CONFIG_SCHEMA_VERSION;
  exported_at: string;
  settings: Record<string, string>;
  content_definitions: ConfigPillar[];
  compositions: ConfigComposition[];
  sources: ConfigSource[];
}

export function createConfigExport(
  settings: Readonly<Record<string, string>>,
  sources: readonly ConfigSource[],
  pillarsOrExportedAt: readonly ConfigPillar[] | string = [],
  exportedAt = new Date().toISOString(),
  compositions: readonly ConfigComposition[] = [],
): ConfigExport {
  const pillars = typeof pillarsOrExportedAt === 'string' ? [] : pillarsOrExportedAt;
  const effectiveExportedAt = typeof pillarsOrExportedAt === 'string' ? pillarsOrExportedAt : exportedAt;
  return {
    format: CONFIG_FORMAT,
    schema_version: CONFIG_SCHEMA_VERSION,
    exported_at: effectiveExportedAt,
    settings: Object.fromEntries([...EXPORTABLE_SETTING_KEYS]
      .filter(key => typeof settings[key] === 'string')
      .map(key => [key, settings[key]])),
    content_definitions: pillars.map(pillar => ({ ...pillar })),
    compositions: compositions.map(composition => ({ ...composition })),
    sources: sources.map(source => ({
      name: source.name,
      url: source.url,
      pillar: source.pillar,
      source_type: source.source_type,
      approved: Boolean(source.approved),
    })),
  };
}

export function applyConfigImport(db: DatabaseSync, config: ConfigExport): { settings: number; sources: number } {
  const now = Date.now();
  const findSource = db.prepare('SELECT id FROM sources WHERE url = ? LIMIT 1');
  const updateSource = db.prepare('UPDATE sources SET name = ?, pillar = ?, source_type = ?, approved = ? WHERE id = ?');
  const insertSource = db.prepare(
    'INSERT INTO sources (name, url, pillar, source_type, last_checked, approved, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)',
  );
  if (config.content_definitions.length > 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS content_pillars (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        weight INTEGER NOT NULL DEFAULT 1,
        locale TEXT NOT NULL DEFAULT 'id',
        source_policy TEXT NOT NULL DEFAULT 'any',
        promo_eligible INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0
      )
    `);
  }
  const updatePillar = config.content_definitions.length > 0 ? db.prepare(`
    UPDATE content_pillars
    SET name = ?, enabled = ?, weight = ?, locale = ?, source_policy = ?, promo_eligible = ?, position = ?
    WHERE slug = ?
  `) : null;
  const insertPillar = config.content_definitions.length > 0 ? db.prepare(`
    INSERT INTO content_pillars
      (slug, name, enabled, weight, locale, source_policy, promo_eligible, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `) : null;
  if (config.compositions.length > 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS content_compositions (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        locale TEXT NOT NULL DEFAULT 'id',
        post_type TEXT NOT NULL DEFAULT 'any',
        hook_rule TEXT NOT NULL,
        structure_rule TEXT NOT NULL,
        cta_rule TEXT NOT NULL,
        max_length INTEGER NOT NULL DEFAULT 500,
        mode TEXT NOT NULL DEFAULT 'standalone',
        hashtag_policy TEXT NOT NULL,
        source_link_policy TEXT NOT NULL,
        prompt_text TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0
      )
    `);
  }
  const updateComposition = config.compositions.length > 0 ? db.prepare(`
    UPDATE content_compositions
    SET name = ?, enabled = ?, locale = ?, post_type = ?, hook_rule = ?, structure_rule = ?, cta_rule = ?, max_length = ?, mode = ?, hashtag_policy = ?, source_link_policy = ?, prompt_text = ?, position = ?
    WHERE slug = ?
  `) : null;
  const insertComposition = config.compositions.length > 0 ? db.prepare(`
    INSERT INTO content_compositions
      (slug, name, enabled, locale, post_type, hook_rule, structure_rule, cta_rule, max_length, mode, hashtag_policy, source_link_policy, prompt_text, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `) : null;

  db.exec('BEGIN IMMEDIATE');
  try {
    const setting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [key, value] of Object.entries(config.settings)) setting.run(key, value);
    for (const pillar of config.content_definitions) {
      if (!updatePillar || !insertPillar) throw new Error('Content pillar import is unavailable');
      const existing = db.prepare('SELECT slug FROM content_pillars WHERE slug = ?').get(pillar.slug);
      if (existing) updatePillar.run(pillar.name, pillar.enabled ? 1 : 0, pillar.weight, pillar.locale, pillar.source_policy, pillar.promo_eligible ? 1 : 0, pillar.position, pillar.slug);
      else insertPillar.run(pillar.slug, pillar.name, pillar.enabled ? 1 : 0, pillar.weight, pillar.locale, pillar.source_policy, pillar.promo_eligible ? 1 : 0, pillar.position);
    }
    if (config.content_definitions.length > 0) normalizeContentPillarWeights(db);
    for (const composition of config.compositions) {
      if (!updateComposition || !insertComposition) throw new Error('Content composition import is unavailable');
      const existing = db.prepare('SELECT slug FROM content_compositions WHERE slug = ?').get(composition.slug);
      const values = [composition.name, composition.enabled ? 1 : 0, composition.locale, composition.post_type, composition.hook_rule, composition.structure_rule, composition.cta_rule, composition.max_length, composition.mode, composition.hashtag_policy, composition.source_link_policy, composition.prompt_text, composition.position, composition.slug];
      if (existing) updateComposition.run(...values);
      else insertComposition.run(composition.slug, ...values.slice(0, -1));
    }
    for (const source of config.sources) {
      const existing = findSource.get(source.url) as { id: number } | null;
      if (existing) updateSource.run(source.name, source.pillar, source.source_type, source.approved ? 1 : 0, existing.id);
      else insertSource.run(source.name, source.url, source.pillar, source.source_type, source.approved ? 1 : 0, now);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { settings: Object.keys(config.settings).length, sources: config.sources.length };
}

export function validateConfigImport(input: unknown): { config: ConfigExport } | { error: string } {
  if (!isRecord(input) || input.format !== CONFIG_FORMAT || input.schema_version !== CONFIG_SCHEMA_VERSION) {
    return { error: 'Format konfigurasi atau versi tidak didukung' };
  }
  if (!isRecord(input.settings)) return { error: 'Settings konfigurasi tidak valid' };
  if (!Array.isArray(input.content_definitions) || input.content_definitions.length > 1000) return { error: 'Content definitions tidak valid atau terlalu besar' };
  const rawCompositions = input.compositions === undefined ? [] : input.compositions;
  if (!Array.isArray(rawCompositions) || rawCompositions.length > 1000) return { error: 'Compositions tidak valid atau terlalu besar' };
  if (!Array.isArray(input.sources) || input.sources.length > 10_000) return { error: 'Daftar source tidak valid atau terlalu besar' };

  const settings: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(input.settings)) {
    if (!EXPORTABLE_SETTING_KEYS.has(key)) return { error: `Setting tidak dapat diimpor: ${key}` };
    const value = validateSettingValue(key, rawValue);
    if (value instanceof Error) return { error: `${key}: ${value.message}` };
    settings[key] = value;
  }
  const mergedSettings = { ...settings };
  for (const key of ['posts_per_day', 'active_hours_start', 'active_hours_end'] as const) {
    if (!mergedSettings[key]) mergedSettings[key] = key === 'posts_per_day' ? '3' : key === 'active_hours_start' ? '8' : '20';
  }
  for (const key of ['posts_per_day', 'active_hours_start', 'active_hours_end']) {
    const error = validateScheduleWindow(key, mergedSettings[key], mergedSettings);
    if (error) return { error };
  }

  const urls = new Set<string>();
  const sources: ConfigSource[] = [];
  for (const rawSource of input.sources) {
    if (!isRecord(rawSource)) return { error: 'Format source tidak valid' };
    const name = typeof rawSource.name === 'string' ? rawSource.name.trim() : '';
    const url = typeof rawSource.url === 'string' ? rawSource.url.trim() : '';
    const pillar = typeof rawSource.pillar === 'string' ? rawSource.pillar.trim() : '';
    const sourceType = typeof rawSource.source_type === 'string' ? rawSource.source_type.trim() : '';
    if (!name || name.length > 160 || !isSafeSourceUrl(url) || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(pillar) || !sourceType || sourceType.length > 80 || typeof rawSource.approved !== 'boolean') {
      return { error: `Source tidak valid: ${name || url || 'unknown'}` };
    }
    if (urls.has(url)) return { error: `Source duplikat dalam import: ${url}` };
    urls.add(url);
    sources.push({ name, url, pillar, source_type: sourceType, approved: rawSource.approved });
  }

  const pillarSlugs = new Set<string>();
  const pillars: ConfigPillar[] = [];
  for (const rawPillar of input.content_definitions) {
    if (!isRecord(rawPillar)) return { error: 'Format content definition tidak valid' };
    const slug = typeof rawPillar.slug === 'string' ? rawPillar.slug.trim() : '';
    const name = typeof rawPillar.name === 'string' ? rawPillar.name.trim() : '';
    const locale = rawPillar.locale;
    const sourcePolicy = rawPillar.source_policy;
    const weight = rawPillar.weight;
    const position = rawPillar.position;
    if (!isValidPillarSlug(slug) || pillarSlugs.has(slug) || !name || name.length > 160 || typeof rawPillar.enabled !== 'boolean' || typeof weight !== 'number' || !Number.isInteger(weight) || weight < 0 || weight > 1000 || (locale !== 'id' && locale !== 'en') || !isValidPillarSourcePolicy(sourcePolicy) || typeof rawPillar.promo_eligible !== 'boolean' || typeof position !== 'number' || !Number.isInteger(position) || position < 0) {
      return { error: `Content definition tidak valid: ${slug || name || 'unknown'}` };
    }
    pillarSlugs.add(slug);
    pillars.push({ slug, name, enabled: rawPillar.enabled, weight, locale: locale as PillarLocale, source_policy: sourcePolicy, promo_eligible: rawPillar.promo_eligible, position });
  }

  const compositionSlugs = new Set<string>();
  const compositions: ConfigComposition[] = [];
  for (const rawComposition of rawCompositions) {
    if (!isRecord(rawComposition)) return { error: 'Format composition tidak valid' };
    const slug = typeof rawComposition.slug === 'string' ? rawComposition.slug.trim() : '';
    const stringFields = ['name', 'hook_rule', 'structure_rule', 'cta_rule', 'hashtag_policy', 'source_link_policy', 'prompt_text'] as const;
    const values = Object.fromEntries(stringFields.map(field => [field, typeof rawComposition[field] === 'string' ? rawComposition[field].trim() : ''])) as Record<typeof stringFields[number], string>;
    const enabled = rawComposition.enabled;
    const locale = rawComposition.locale;
    const postType = rawComposition.post_type;
    const maxLength = rawComposition.max_length;
    const mode = rawComposition.mode;
    const position = rawComposition.position;
    if (!isValidCompositionSlug(slug) || compositionSlugs.has(slug) || !values.name || values.name.length > 160 || typeof enabled !== 'boolean' || (locale !== 'id' && locale !== 'en') || !['any', 'education', 'promotion'].includes(String(postType)) || typeof maxLength !== 'number' || !Number.isInteger(maxLength) || maxLength < 1 || maxLength > 500 || !['standalone', 'thread'].includes(String(mode)) || Object.values(values).some(value => value.length > 4000) || typeof position !== 'number' || !Number.isInteger(position) || position < 0) {
      return { error: `Composition tidak valid: ${slug || values.name || 'unknown'}` };
    }
    compositionSlugs.add(slug);
    compositions.push({ slug, ...values, enabled, locale, post_type: postType as ConfigComposition['post_type'], max_length: maxLength, mode: mode as ConfigComposition['mode'], position });
  }

  return {
    config: {
      format: CONFIG_FORMAT,
      schema_version: CONFIG_SCHEMA_VERSION,
      exported_at: typeof input.exported_at === 'string' ? input.exported_at : new Date().toISOString(),
      settings,
      content_definitions: pillars,
      compositions,
      sources,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
