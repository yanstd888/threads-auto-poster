import type { DatabaseSync } from 'node:sqlite';
import { getDb } from './db';

export type PillarLocale = 'id' | 'en';
export type PillarSourcePolicy = 'any' | 'github_repository';

export interface ContentPillar {
  slug: string;
  name: string;
  enabled: boolean;
  weight: number;
  locale: PillarLocale;
  source_policy: PillarSourcePolicy;
  promo_eligible: boolean;
  position: number;
}

export const DEFAULT_CONTENT_PILLARS: ContentPillar[] = [
  { slug: 'umkm', name: 'Website untuk UMKM', enabled: true, weight: 30, locale: 'id', source_policy: 'any', promo_eligible: true, position: 0 },
  { slug: 'ai', name: 'AI agent skill terbaik', enabled: true, weight: 25, locale: 'id', source_policy: 'github_repository', promo_eligible: false, position: 1 },
  { slug: 'github', name: 'GitHub repo terbaik', enabled: true, weight: 25, locale: 'id', source_policy: 'github_repository', promo_eligible: false, position: 2 },
  { slug: 'security', name: 'Cyber security', enabled: true, weight: 20, locale: 'id', source_policy: 'any', promo_eligible: false, position: 3 },
];

export function getContentPillars(db: DatabaseSync = getDb(), enabledOnly = false): ContentPillar[] {
  try {
    const rows = db.prepare(`
      SELECT slug, name, enabled, weight, locale, source_policy, promo_eligible, position
      FROM content_pillars
      ${enabledOnly ? 'WHERE enabled = 1' : ''}
      ORDER BY position ASC, slug ASC
    `).all() as Array<Record<string, unknown>>;
    return rows.map(toContentPillar);
  } catch {
    return DEFAULT_CONTENT_PILLARS.filter(pillar => !enabledOnly || pillar.enabled).map(pillar => ({ ...pillar }));
  }
}

export function getContentPillar(slug: string, db: DatabaseSync = getDb()): ContentPillar | undefined {
  return getContentPillars(db).find(pillar => pillar.slug === slug);
}

export function normalizeContentPillarWeights(db: DatabaseSync = getDb()): void {
  const pillars = getContentPillars(db).filter(pillar => pillar.enabled);
  if (pillars.length === 0) return;
  const total = pillars.reduce((sum, pillar) => sum + Math.max(0, pillar.weight), 0);
  const raw = pillars.map(pillar => ({
    ...pillar,
    exact: total > 0 ? (Math.max(0, pillar.weight) * 100) / total : 100 / pillars.length,
  }));
  const weights = raw.map(pillar => Math.floor(pillar.exact));
  let remainder = 100 - weights.reduce((sum, weight) => sum + weight, 0);
  const order = raw.map((pillar, index) => ({ index, fraction: pillar.exact - weights[index] }))
    .sort((a, b) => b.fraction - a.fraction || raw[a.index].position - raw[b.index].position);
  for (const item of order) {
    if (remainder <= 0) break;
    weights[item.index] += 1;
    remainder -= 1;
  }
  const update = db.prepare('UPDATE content_pillars SET weight = ? WHERE slug = ?');
  pillars.forEach((pillar, index) => update.run(weights[index], pillar.slug));
}

export function seedDefaultContentPillars(db: DatabaseSync = getDb()): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO content_pillars
      (slug, name, enabled, weight, locale, source_policy, promo_eligible, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const pillar of DEFAULT_CONTENT_PILLARS) {
    insert.run(
      pillar.slug,
      pillar.name,
      pillar.enabled ? 1 : 0,
      pillar.weight,
      pillar.locale,
      pillar.source_policy,
      pillar.promo_eligible ? 1 : 0,
      pillar.position,
    );
  }
}

export function isValidPillarSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
}

export function isValidPillarSourcePolicy(value: unknown): value is PillarSourcePolicy {
  return value === 'any' || value === 'github_repository';
}

function toContentPillar(row: Record<string, unknown>): ContentPillar {
  return {
    slug: String(row.slug),
    name: String(row.name),
    enabled: Number(row.enabled) === 1,
    weight: Math.max(0, Number(row.weight) || 0),
    locale: row.locale === 'en' ? 'en' : 'id',
    source_policy: row.source_policy === 'github_repository' ? 'github_repository' : 'any',
    promo_eligible: Number(row.promo_eligible) === 1,
    position: Math.max(0, Number(row.position) || 0),
  };
}
