import type { DatabaseSync } from 'node:sqlite';

export interface StoredPost {
  id: number;
  content: string;
  replies: string | null;
  status: string;
  threads_id: string | null;
  threads_url: string | null;
}

export type PublishClaim =
  | { kind: 'claimed'; post: StoredPost }
  | { kind: 'already_posted'; post: StoredPost }
  | { kind: 'publishing'; post: StoredPost }
  | { kind: 'not_publishable'; post: StoredPost }
  | { kind: 'not_found' };

export function claimPostForPublishing(db: DatabaseSync, postId: number, allowedStatuses: string[]): PublishClaim {
  const placeholders = allowedStatuses.map(() => '?').join(', ');
  const claim = db.prepare(
    `UPDATE posts
     SET status = 'publishing'
     WHERE id = ? AND threads_id IS NULL AND status IN (${placeholders})`
  ).run(postId, ...allowedStatuses);

  const post = db.prepare(
    'SELECT id, content, replies, status, threads_id, threads_url FROM posts WHERE id = ?'
  ).get(postId) as unknown as StoredPost | undefined;

  if (!post) return { kind: 'not_found' };
  if (claim.changes === 1) return { kind: 'claimed', post };
  if (post.threads_id || post.status === 'posted' || post.status === 'posted_unverified') {
    return { kind: 'already_posted', post };
  }
  if (post.status === 'publishing') return { kind: 'publishing', post };
  return { kind: 'not_publishable', post };
}
