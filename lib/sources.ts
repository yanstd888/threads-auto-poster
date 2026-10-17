import { getDb } from './db';

export function getApprovedSourceUrls(pillar: string): string[] {
  return (getDb().prepare(
    'SELECT url FROM sources WHERE pillar = ? AND approved = 1 ORDER BY id ASC',
  ).all(pillar) as { url: string }[]).map(source => source.url);
}
