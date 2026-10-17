import { getDb, logAudit } from './db';
import { claimPostForPublishing } from './publish-claim';
import { postToThreads } from './threads-api';

export type PublishStoredPostResult =
  | { kind: 'posted'; id: string; url: string; verified: boolean }
  | { kind: 'already_posted'; id: string | null; url: string | null }
  | { kind: 'publishing' }
  | { kind: 'not_publishable'; status: string }
  | { kind: 'not_found' }
  | { kind: 'failed'; error: string; retryable: boolean };

export async function publishStoredPost(postId: number, allowedStatuses: string[]): Promise<PublishStoredPostResult> {
  const db = getDb();
  const claim = claimPostForPublishing(db, postId, allowedStatuses);

  if (claim.kind === 'already_posted') {
    return { kind: 'already_posted', id: claim.post.threads_id, url: claim.post.threads_url };
  }
  if (claim.kind === 'publishing') return { kind: 'publishing' };
  if (claim.kind === 'not_publishable') return { kind: 'not_publishable', status: claim.post.status };
  if (claim.kind === 'not_found') return { kind: 'not_found' };

  let replies: string[];
  try {
    const parsed: unknown = claim.post.replies ? JSON.parse(claim.post.replies) : [];
    if (!Array.isArray(parsed) || !parsed.every(reply => typeof reply === 'string')) throw new Error('invalid replies');
    replies = parsed;
  } catch {
    db.prepare("UPDATE posts SET status = 'failed', retry_count = retry_count + 1 WHERE id = ? AND status = 'publishing'").run(postId);
    return { kind: 'failed', error: 'Format reply draft tidak valid', retryable: false };
  }
  const attributes = db.prepare('SELECT topic_tag FROM post_attributes WHERE post_id = ?').get(postId) as { topic_tag: string | null } | undefined;
  const result = await postToThreads({
    text: claim.post.content,
    replies,
    topicTag: attributes?.topic_tag || undefined,
  });

  if ('partial' in result) {
    db.prepare("UPDATE posts SET status = 'publish_unknown', threads_id = ?, threads_url = ?, reply_ids = ?, posted_at = ? WHERE id = ? AND status = 'publishing'")
      .run(result.id, result.url, JSON.stringify(result.replyIds), Date.now(), postId);
    logAudit('post_partial', `post ${postId}: root=${result.id} ${result.error}`);
    return { kind: 'failed', error: result.error, retryable: false };
  }

  if ('error' in result) {
    const status = result.safeToRetry ? 'failed' : 'publish_unknown';
    db.prepare('UPDATE posts SET status = ?, retry_count = retry_count + 1 WHERE id = ? AND status = ?')
      .run(status, postId, 'publishing');
    logAudit('post_failed', `post ${postId}: retryable=${result.safeToRetry} ${result.error}`);
    return { kind: 'failed', error: result.error, retryable: result.safeToRetry };
  }

  db.prepare(
    'UPDATE posts SET status = ?, threads_id = ?, threads_url = ?, reply_ids = ?, posted_at = ? WHERE id = ? AND status = ?'
  ).run(result.verified ? 'posted' : 'posted_unverified', result.id, result.url, JSON.stringify(result.replyIds), Date.now(), postId, 'publishing');
  logAudit('post_success', `post ${postId}: ${result.id} verified=${result.verified}`);
  return { kind: 'posted', id: result.id, url: result.url, verified: result.verified };
}
