import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { seedDefaultContentPillars } from './content-pillars';
import { seedDefaultContentCompositions } from './content-compositions';

const dataDir = process.env.THREADS_DATA_DIR || path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'app.db');
fs.mkdirSync(dataDir, { recursive: true });

let db: DatabaseSync;
let isInitialized = false;

export function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  }
  return db;
}

export function initDB() {
  if (isInitialized) return;
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tokens (
      id TEXT PRIMARY KEY,
      service TEXT NOT NULL,
      encrypted_token TEXT NOT NULL,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      pillar TEXT NOT NULL,
      source_type TEXT NOT NULL,
      last_checked INTEGER,
      approved INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_pillars (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      weight INTEGER NOT NULL DEFAULT 1,
      locale TEXT NOT NULL DEFAULT 'id',
      source_policy TEXT NOT NULL DEFAULT 'any',
      promo_eligible INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0
    );

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
    );

    CREATE TABLE IF NOT EXISTS source_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      data TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_hash TEXT NOT NULL,
      pillar TEXT NOT NULL,
      topic TEXT NOT NULL,
      link TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_reservations (
      source_url TEXT PRIMARY KEY,
      schedule_id INTEGER NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_time INTEGER NOT NULL,
      pillar TEXT NOT NULL,
      post_type TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      UNIQUE(slot_time)
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER,
      content TEXT,
      replies TEXT,
      pillar TEXT,
      post_type TEXT,
      source_urls TEXT,
      quality_status TEXT,
      quality_reasons TEXT,
      threads_id TEXT,
      threads_url TEXT,
      status TEXT DEFAULT 'draft',
      created_at INTEGER NOT NULL,
      posted_at INTEGER,
      retry_count INTEGER DEFAULT 0,
      FOREIGN KEY (schedule_id) REFERENCES schedule(id)
    );

    CREATE TABLE IF NOT EXISTS metrics (
      post_id INTEGER PRIMARY KEY,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      replies INTEGER DEFAULT 0,
      reposts INTEGER DEFAULT 0,
      quotes INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      details TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_credentials (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL
    );
  `);

  const legacyUsers = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").get() as { name: string } | undefined;
  if (legacyUsers) {
    const legacy = d.prepare('SELECT password_hash FROM users ORDER BY rowid LIMIT 1').get() as { password_hash: string } | undefined;
    if (legacy?.password_hash) d.prepare('INSERT OR IGNORE INTO admin_credentials (id, password_hash) VALUES (1, ?)').run(legacy.password_hash);
    d.exec('DROP TABLE users');
  }

  for (const migration of [
    'ALTER TABLE schedule ADD COLUMN retry_at INTEGER',
    'ALTER TABLE schedule ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE schedule ADD COLUMN last_error TEXT',
    'ALTER TABLE source_snapshots ADD COLUMN sha256 TEXT',
    'ALTER TABLE source_snapshots ADD COLUMN expires_at INTEGER',
    'ALTER TABLE posts ADD COLUMN reply_ids TEXT',
    'ALTER TABLE metrics ADD COLUMN quotes INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE metrics ADD COLUMN shares INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE metric_snapshots ADD COLUMN quotes INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE metric_snapshots ADD COLUMN shares INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE post_attributes ADD COLUMN topic_tag TEXT',
    'ALTER TABLE post_attributes ADD COLUMN composition_slug TEXT',
  ]) {
    try { d.exec(migration); } catch {}
  }

  d.exec(`
    CREATE TABLE IF NOT EXISTS source_health (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      checked_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('live', 'transient', 'dead', 'redirect', 'snapshot')),
      http_status INTEGER,
      content_bytes INTEGER,
      error_kind TEXT,
      FOREIGN KEY (source_id) REFERENCES sources(id)
    );
    CREATE INDEX IF NOT EXISTS idx_source_snapshots_fresh ON source_snapshots(source_id, expires_at DESC);
    CREATE INDEX IF NOT EXISTS idx_source_health_recent ON source_health(source_id, checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_content_history_link_time ON content_history(link, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_content_history_created_at ON content_history(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sources_pillar_approved ON sources(pillar, approved);
    CREATE INDEX IF NOT EXISTS idx_content_pillars_enabled_position ON content_pillars(enabled, position);
    CREATE INDEX IF NOT EXISTS idx_content_compositions_enabled_position ON content_compositions(enabled, position);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action_time ON audit_log(action, created_at DESC);
    CREATE TABLE IF NOT EXISTS post_attributes (
      post_id INTEGER PRIMARY KEY,
      hook_mechanism TEXT,
      content_format TEXT,
      cta_mechanism TEXT,
      paragraph_count INTEGER,
      length_chars INTEGER,
      posting_hour INTEGER,
      promotion_flag INTEGER NOT NULL DEFAULT 0,
      source_domains TEXT,
      source_count INTEGER NOT NULL DEFAULT 0,
      source_claims TEXT,
      primary_source_url TEXT,
      topic_tag TEXT,
      FOREIGN KEY (post_id) REFERENCES posts(id)
    );
    CREATE TABLE IF NOT EXISTS metric_snapshots (
      post_id INTEGER NOT NULL,
      checkpoint TEXT NOT NULL CHECK (checkpoint IN ('1h', '24h', '7d')),
      views INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      replies INTEGER NOT NULL DEFAULT 0,
      reposts INTEGER NOT NULL DEFAULT 0,
      quotes INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0,
      captured_at INTEGER NOT NULL,
      PRIMARY KEY (post_id, checkpoint),
      FOREIGN KEY (post_id) REFERENCES posts(id)
    );
    CREATE TABLE IF NOT EXISTS asset_plans (
      post_id INTEGER PRIMARY KEY,
      asset_type TEXT NOT NULL,
      rationale TEXT NOT NULL,
      alt_text_draft TEXT NOT NULL,
      topic_candidate TEXT,
      experiment_status TEXT NOT NULL DEFAULT 'planned',
      FOREIGN KEY (post_id) REFERENCES posts(id)
    );
  `);

  // ponytail: snapshots are transient fallback cache, so expired and identical entries have no retention value.
  d.prepare('DELETE FROM source_snapshots WHERE expires_at IS NOT NULL AND expires_at <= ?').run(Date.now());
  d.exec(`DELETE FROM source_snapshots
    WHERE sha256 IS NOT NULL AND id NOT IN (
      SELECT MIN(id) FROM source_snapshots WHERE sha256 IS NOT NULL GROUP BY source_id, sha256
    )`);
  d.exec('CREATE UNIQUE INDEX IF NOT EXISTS source_snapshots_one_hash ON source_snapshots(source_id, sha256) WHERE sha256 IS NOT NULL');

  // ponytail: keep the first active post; detached duplicates remain auditable but cannot be republished by a schedule.
  d.exec(`
    UPDATE posts SET schedule_id = NULL
    WHERE id IN (
      SELECT duplicate_post.id FROM posts duplicate_post
      JOIN (
        SELECT schedule_id, MIN(id) AS keep_id
        FROM posts
        WHERE schedule_id IS NOT NULL AND status IN ('scheduled', 'publishing', 'posted', 'posted_unverified', 'failed', 'publish_unknown')
        GROUP BY schedule_id HAVING COUNT(*) > 1
      ) duplicates ON duplicates.schedule_id = duplicate_post.schedule_id
      WHERE duplicate_post.id <> duplicates.keep_id
    );
    CREATE UNIQUE INDEX IF NOT EXISTS posts_one_active_per_schedule
      ON posts(schedule_id)
      WHERE schedule_id IS NOT NULL AND status IN ('scheduled', 'publishing', 'posted', 'posted_unverified', 'failed', 'publish_unknown');
  `);

  const defaultSettings: [string, string][] = [
    ['posts_per_day', '3'],
    ['active_hours_start', '8'],
    ['active_hours_end', '20'],
    ['active_days', JSON.stringify([1,2,3,4,5,6,0])],
    ['timezone', 'Asia/Jakarta'],
    ['pillar_weights', JSON.stringify({github:25, ai:25, umkm:30, security:20})],
    ['promo_ratio', '0.2'],
    ['promo_offer', 'konsultasi kebutuhan website'],
    ['promo_reason', 'agar pembaca tahu langkah perbaikan website yang paling prioritas'],
    ['ui_locale', 'id'],
    ['content_locale', 'id'],
    ['github_url', ''],
    ['website_url', ''],
    ['posting_mode', 'approval'],
    ['kill_switch', 'false'],
    ['content_agent_enabled', 'true'],
    ['hermes_provider', 'openai-compatible'],
    ['hermes_model', 'default'],
    ['hermes_profile', 'default'],
    ['source_snapshot_ttl_ms', '900000'],
  ];

  const insertStmt = d.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of defaultSettings) {
    insertStmt.run(key, value);
  }
  seedDefaultContentPillars(d);
  seedDefaultContentCompositions(d);
  isInitialized = true;
}

export function getSetting(key: string): string | null {
  const d = getDb();
  const row = d.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const d = getDb();
  d.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const d = getDb();
  const rows = d.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r: {key: string; value: string}) => [r.key, r.value]));
}

export function logAudit(action: string, details?: string, database?: DatabaseSync): void {
  const d = database ?? getDb();
  d.prepare('INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, ?)')
    .run(action, details ?? null, Date.now());
}

export default getDb;
