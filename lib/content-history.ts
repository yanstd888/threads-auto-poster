import { getDb } from './db';
import type { DatabaseSync } from 'node:sqlite';

const SOURCE_RESERVATION_MS = 6 * 60 * 1000;

export interface ContentHistoryEntry {
  topicHash: string;
  pillar: string;
  topic: string;
  link: string;
  createdAt: number;
}

export const contentHistoryRepository = {
  add(entry: ContentHistoryEntry) {
    const db = getDb();
    db.prepare(
      'INSERT INTO content_history (topic_hash, pillar, topic, link, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(entry.topicHash, entry.pillar, entry.topic, entry.link, entry.createdAt);
  },

  addSync(entry: ContentHistoryEntry) {
    this.add(entry);
  },

  getRecentTopics(days: number = 14): { topic: string; pillar: string; createdAt: number }[] {
    return this.getRecentTopicsSync(days);
  },

  getRecentTopicsSync(days: number = 14): { topic: string; pillar: string; createdAt: number }[] {
    const db = getDb();
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return db.prepare(
      'SELECT topic, pillar, created_at as createdAt FROM content_history WHERE created_at > ? ORDER BY created_at DESC LIMIT(100)'
    ).all(cutoff) as { topic: string; pillar: string; createdAt: number }[];
  },

  getRecentLinksSync(days: number = 14): string[] {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return (getDb().prepare('SELECT DISTINCT link FROM content_history WHERE created_at > ? AND link <> \'\'').all(cutoff) as { link: string }[]).map(row => row.link);
  },

  isTopicUsed(topic: string, days: number = 7): boolean {
    const db = getDb();
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const row = db.prepare(
      'SELECT COUNT(*) as count FROM content_history WHERE created_at > ? AND topic_hash = ?'
    ).get(cutoff, topic.slice(0, 100)) as { count: number } | undefined;
    return (row?.count ?? 0) > 0;
  },

  isLinkUsed(link: string, days: number = 7): boolean {
    const db = getDb();
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const row = db.prepare(
      'SELECT COUNT(*) as count FROM content_history WHERE created_at > ? AND link = ?'
    ).get(cutoff, link) as { count: number } | undefined;
    return (row?.count ?? 0) > 0;
  },

  getStats(): { total: number; byPillar: Record<string, number> } {
    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) as count FROM content_history').get() as { count: number };
    const byPillar = db.prepare('SELECT pillar, COUNT(*) as count FROM content_history GROUP BY pillar').all() as { pillar: string; count: number }[];

    return {
      total: total.count,
      byPillar: Object.fromEntries(byPillar.map((p: { pillar: string; count: number }) => [p.pillar, p.count])),
    };
  },
};

export function reservePrimarySource(
  db: DatabaseSync,
  scheduleId: number,
  candidateUrls: string[],
  days = 14,
  now = Date.now(),
): string | null {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM source_reservations WHERE expires_at <= ?').run(now);
    for (const url of candidateUrls) {
      const used = db.prepare('SELECT 1 FROM content_history WHERE link = ? AND created_at > ? LIMIT 1').get(url, cutoff);
      const reservation = db.prepare('SELECT schedule_id FROM source_reservations WHERE source_url = ? LIMIT 1').get(url) as { schedule_id: number } | undefined;
      if (used || (reservation && reservation.schedule_id !== scheduleId)) continue;
      if (reservation?.schedule_id === scheduleId) {
        db.exec('COMMIT');
        return url;
      }
      const inserted = db.prepare('INSERT OR IGNORE INTO source_reservations (source_url, schedule_id, expires_at) VALUES (?, ?, ?)')
        .run(url, scheduleId, now + SOURCE_RESERVATION_MS);
      if (inserted.changes === 1) {
        db.exec('COMMIT');
        return url;
      }
    }
    db.exec('COMMIT');
    return null;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function releasePrimarySourceReservation(db: DatabaseSync, scheduleId: number, sourceUrl: string): void {
  db.prepare('DELETE FROM source_reservations WHERE schedule_id = ? AND source_url = ?').run(scheduleId, sourceUrl);
}
