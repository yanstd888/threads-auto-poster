import type { DatabaseSync } from 'node:sqlite';
import { getDb } from './db';
import { getContentPillars } from './content-pillars';

export type ReplyTargetType = 'account' | 'keyword' | 'topic' | 'community_bundle' | 'free';
export type ReplyLanguageMode = 'match_target' | 'id' | 'en';
export type ReplySearchType = 'TOP' | 'RECENT';

export interface ReplyTargetConfig {
  includeTerms?: string[];
  excludeTerms?: string[];
  language?: ReplyLanguageMode;
  searchType?: ReplySearchType;
  accounts?: string[];
  keywords?: string[];
  topics?: string[];
}

export interface ReplyTarget {
  id: number;
  target_type: ReplyTargetType;
  label: string;
  value: string | null;
  config: ReplyTargetConfig;
  enabled: boolean;
  weight: number;
  last_scanned_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ReplyTargetInput {
  target_type: ReplyTargetType;
  label: string;
  value?: string | null;
  config?: ReplyTargetConfig | string | null;
  enabled?: boolean;
  weight?: number;
}

const USERNAME_PATTERN = /^[a-z0-9._]{1,30}$/i;
const TARGET_TYPES = new Set<ReplyTargetType>(['account', 'keyword', 'topic', 'community_bundle', 'free']);

export function getReplyTargets(db: DatabaseSync = getDb(), enabledOnly = false): ReplyTarget[] {
  const rows = db.prepare(`
    SELECT id, target_type, label, value, config_json, enabled, weight, last_scanned_at, created_at, updated_at
    FROM reply_targets
    ${enabledOnly ? 'WHERE enabled = 1 AND weight > 0' : ''}
    ORDER BY enabled DESC, weight DESC, id ASC
  `).all() as Array<Record<string, unknown>>;
  return rows.map(toReplyTarget);
}

export function getReplyTarget(id: number, db: DatabaseSync = getDb()): ReplyTarget | null {
  const row = db.prepare(`
    SELECT id, target_type, label, value, config_json, enabled, weight, last_scanned_at, created_at, updated_at
    FROM reply_targets WHERE id = ?
  `).get(id) as Record<string, unknown> | undefined;
  return row ? toReplyTarget(row) : null;
}

export function validateReplyTargetInput(input: ReplyTargetInput, db: DatabaseSync = getDb(), existingId?: number): { target: Omit<ReplyTarget, 'id' | 'created_at' | 'updated_at' | 'last_scanned_at'> } | { error: string } {
  if (!TARGET_TYPES.has(input.target_type)) return { error: 'Jenis target tidak valid' };
  const label = String(input.label || '').trim();
  if (!label || label.length > 160) return { error: 'Label target wajib 1–160 karakter' };
  const weight = Number(input.weight ?? 1);
  if (!Number.isInteger(weight) || weight < 0 || weight > 1000) return { error: 'Bobot target harus bilangan bulat 0–1000' };
  if (input.enabled !== false && weight <= 0) return { error: 'Target aktif harus memiliki bobot lebih besar dari 0' };

  let value = input.value == null ? null : String(input.value).trim();
  if (input.target_type === 'account') {
    const username = normalizeReplyUsername(value || '');
    if (!username || !USERNAME_PATTERN.test(username)) return { error: 'Username target tidak valid; gunakan username Threads tanpa URL' };
    const duplicate = db.prepare("SELECT id FROM reply_targets WHERE target_type = 'account' AND lower(value) = lower(?) AND enabled = 1 AND id <> ? LIMIT 1")
      .get(username, existingId || 0);
    if (duplicate) return { error: 'Username account target sudah terdaftar' };
    value = username;
  } else if (input.target_type === 'keyword' || input.target_type === 'topic') {
    if (!value || value.length > 160 || /https?:\/\//i.test(value)) return { error: 'Keyword/topic harus berupa teks, bukan URL' };
  } else if (input.target_type === 'community_bundle') {
    if (!value || value.length > 160) return { error: 'Nama custom community bundle wajib 1–160 karakter' };
  } else {
    value = null;
  }

  const config = normalizeTargetConfig(input.config);
  if ('error' in config) return config;
  if (input.target_type === 'community_bundle' && !config.value.accounts?.length && !config.value.keywords?.length && !config.value.topics?.length) {
    return { error: 'Custom community bundle harus punya minimal satu account, keyword, atau topic' };
  }
  if (config.value.accounts?.some(account => !USERNAME_PATTERN.test(account))) return { error: 'Account dalam bundle tidak valid' };
  return { target: { target_type: input.target_type, label, value, config: config.value, enabled: input.enabled !== false, weight } };
}

export function addReplyTarget(input: ReplyTargetInput, db: DatabaseSync = getDb()): ReplyTarget | { error: string } {
  const checked = validateReplyTargetInput(input, db);
  if ('error' in checked) return checked;
  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO reply_targets (target_type, label, value, config_json, enabled, weight, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(checked.target.target_type, checked.target.label, checked.target.value, JSON.stringify(checked.target.config), checked.target.enabled ? 1 : 0, checked.target.weight, now, now);
  return getReplyTarget(Number(result.lastInsertRowid), db)!;
}

export function updateReplyTarget(id: number, input: Partial<ReplyTargetInput>, db: DatabaseSync = getDb()): ReplyTarget | { error: string } {
  const current = getReplyTarget(id, db);
  if (!current) return { error: 'Target tidak ditemukan' };
  const checked = validateReplyTargetInput({
    target_type: input.target_type || current.target_type,
    label: input.label ?? current.label,
    value: input.value === undefined ? current.value : input.value,
    config: input.config === undefined ? current.config : input.config,
    enabled: input.enabled === undefined ? current.enabled : input.enabled,
    weight: input.weight === undefined ? current.weight : input.weight,
  }, db, id);
  if ('error' in checked) return checked;
  if (checked.target.enabled && checked.target.weight <= 0) return { error: 'Target aktif harus memiliki bobot lebih besar dari 0' };
  const now = Date.now();
  db.prepare(`
    UPDATE reply_targets
    SET target_type = ?, label = ?, value = ?, config_json = ?, enabled = ?, weight = ?, updated_at = ?
    WHERE id = ?
  `).run(checked.target.target_type, checked.target.label, checked.target.value, JSON.stringify(checked.target.config), checked.target.enabled ? 1 : 0, checked.target.weight, now, id);
  return getReplyTarget(id, db)!;
}

export function deleteReplyTarget(id: number, db: DatabaseSync = getDb()): boolean {
  return db.prepare('UPDATE reply_targets SET enabled = 0, weight = 0, updated_at = ? WHERE id = ?').run(Date.now(), id).changes === 1;
}

export function markReplyTargetScanned(id: number, at = Date.now(), db: DatabaseSync = getDb()): void {
  db.prepare('UPDATE reply_targets SET last_scanned_at = ?, updated_at = ? WHERE id = ?').run(at, at, id);
}

export function normalizeReplyUsername(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase();
}

export function getFreeDiscoverySeeds(db: DatabaseSync = getDb()): string[] {
  const seeds = getContentPillars(db, true).flatMap(pillar => [pillar.name, pillar.slug.replaceAll('-', ' ')]);
  return [...new Set(seeds.map(seed => seed.trim()).filter(seed => seed.length >= 2 && !/^\d+$/.test(seed)))];
}

export function selectReplyTargetsForDiscovery(targets: ReplyTarget[], maxTargets: number, seed = 'reply-discovery'): ReplyTarget[] {
  const eligible = targets.filter(target => target.enabled && target.weight > 0);
  if (!eligible.length || maxTargets <= 0) return [];
  const counts = new Map(eligible.map(target => [target.id, 0]));
  const selected: ReplyTarget[] = [];
  for (let index = 0; index < Math.min(maxTargets, eligible.length); index += 1) {
    const next = eligible.reduce((best, target) => {
      const targetDeficit = (index + 1) * target.weight - (counts.get(target.id) || 0) * eligible.reduce((sum, item) => sum + item.weight, 0);
      const bestDeficit = (index + 1) * best.weight - (counts.get(best.id) || 0) * eligible.reduce((sum, item) => sum + item.weight, 0);
      return targetDeficit > bestDeficit || (targetDeficit === bestDeficit && stableUnit(`${seed}:${index}:${target.id}`) < stableUnit(`${seed}:${index}:${best.id}`)) ? target : best;
    }, eligible[0]);
    counts.set(next.id, (counts.get(next.id) || 0) + 1);
    selected.push(next);
  }
  return selected;
}

function normalizeTargetConfig(value: ReplyTargetConfig | string | null | undefined): { value: ReplyTargetConfig } | { error: string } {
  let raw: unknown = value || {};
  if (typeof value === 'string') {
    try { raw = JSON.parse(value); } catch { return { error: 'config target harus JSON valid' }; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'config target harus object JSON' };
  const object = raw as Record<string, unknown>;
  const list = (key: string, max: number): string[] | undefined => {
    if (object[key] === undefined) return undefined;
    if (!Array.isArray(object[key])) throw new Error(`${key} harus array`);
    const items = [...new Set(object[key].filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))];
    if (items.length > max || items.some(item => item.length > 160)) throw new Error(`${key} tidak valid`);
    return items;
  };
  try {
    const accounts = list('accounts', 50)?.map(normalizeReplyUsername);
    const config: ReplyTargetConfig = {
      includeTerms: list('includeTerms', 30),
      excludeTerms: list('excludeTerms', 30),
      language: object.language === undefined ? undefined : ['match_target', 'id', 'en'].includes(String(object.language)) ? object.language as ReplyLanguageMode : (() => { throw new Error('language tidak valid'); })(),
      searchType: object.searchType === undefined ? undefined : object.searchType === 'TOP' || object.searchType === 'RECENT' ? object.searchType : (() => { throw new Error('searchType tidak valid'); })(),
      accounts,
      keywords: list('keywords', 30),
      topics: list('topics', 30),
    };
    return { value: config };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : 'config target tidak valid' };
  }
}

function toReplyTarget(row: Record<string, unknown>): ReplyTarget {
  let config: ReplyTargetConfig = {};
  try { config = JSON.parse(String(row.config_json || '{}')) as ReplyTargetConfig; } catch {}
  return {
    id: Number(row.id),
    target_type: String(row.target_type) as ReplyTargetType,
    label: String(row.label),
    value: row.value == null ? null : String(row.value),
    config,
    enabled: Number(row.enabled) === 1,
    weight: Math.max(0, Number(row.weight) || 0),
    last_scanned_at: row.last_scanned_at == null ? null : Number(row.last_scanned_at),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  };
}

function stableUnit(value: string): number {
  let hash = 0;
  for (const character of value) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return hash / 0x1_0000_0000;
}
