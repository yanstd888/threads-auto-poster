'use client';

import { useCallback, useEffect, useState } from 'react';
import { Send, RefreshCw, AlertCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { labelForStatus, translateUi } from '@/lib/ui-translations';

interface Post {
  id: number;
  pillar: string;
  post_type: string;
  status: string;
  content: string;
  replies: string[];
  quality_status: string;
  quality_reasons: string;
  threads_url: string | null;
  created_at: number;
  posted_at: number | null;
  retry_count: number;
}

function parseReasons(value: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value ? value.split('; ').filter(Boolean) : [];
  }
}

// ponytail: client-side pagination; move paging into /api/posts if post volume makes full fetch measurable.
const PAGE_SIZE = 10;

export default function PostsPage() {
  const { locale } = useI18n();
  const ui = (key: string, vars?: Record<string, string | number>) => translateUi(locale, key, vars);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const fetchPosts = useCallback(async () => {
    const res = await fetch('/api/posts');
    const data = await res.json();
    setPosts(data.posts || []);
    setLoading(false);
  }, []);

  const handleApprove = async (postId: number) => {
    if (posting === postId) return;
    setPosting(postId);
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', postId }),
      });
      const data = await res.json();
      if (res.ok) {
        setPosts(prev => prev.map(post => post.id === postId
          ? { ...post, status: data.verified ? 'posted' : 'posted_unverified', threads_url: data.url }
          : post));
      } else {
        alert(data.error);
        await fetchPosts();
      }
    } finally {
      setPosting(null);
    }
  };

  const handleRetry = async (postId: number) => {
    setPosting(postId);
    const res = await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'retry', postId }),
    });
    const data = await res.json();
    if (res.ok) {
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, status: 'posted', threads_url: data.url } : p));
    } else {
      alert(data.error);
    }
    setPosting(null);
  };

  const handleDelete = async (postId: number) => {
    if (!confirm(locale === 'en' ? 'Delete this post?' : 'Hapus post ini?')) return;
    await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', postId }),
    });
    setPosts(prev => prev.filter(p => p.id !== postId));
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'posted': return 'bg-green-100 text-green-800';
      case 'draft': return 'bg-yellow-100 text-yellow-800';
      case 'quality_failed': return 'bg-red-100 text-red-800';
      case 'scheduled': return 'bg-blue-100 text-blue-800';
      case 'publishing': return 'bg-blue-100 text-blue-800';
      case 'posted_unverified': return 'bg-amber-100 text-amber-800';
      case 'publish_unknown': return 'bg-amber-100 text-amber-800';
      case 'failed': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  useEffect(() => {
    const initial = setTimeout(() => { void fetchPosts(); }, 0);
    const interval = setInterval(() => { void fetchPosts(); }, 30000);
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, [fetchPosts]);

  if (loading) return <div className="p-6">{ui('Loading...')}</div>;

  const readyPosts = posts.filter(p => p.quality_status === 'passed' && (p.status === 'draft' || p.status === 'scheduled'));
  const failedPosts = posts.filter(p => p.status === 'failed' || p.quality_status === 'failed');
  const totalPages = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedPosts = posts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">{ui('Posts')}</h1>

      {/* Ready content */}
      {readyPosts.length > 0 && (
        <div className="mb-6 hidden">
          <h2 className="font-semibold text-lg mb-3">{locale === 'en' ? 'Ready to Post · Passed' : 'Konten Siap Tayang · Lulus'} ({readyPosts.length})</h2>
          <div className="space-y-4">
            {readyPosts.map((post) => (
              <div key={post.id} className="border rounded-lg p-4 bg-gray-50">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className="text-sm font-medium">{post.pillar}</span>
                    <span className="text-xs text-gray-500 ml-2">({post.post_type})</span>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${getStatusColor(post.status)}`}>
                    {labelForStatus(locale, post.status)}
                  </span>
                </div>

                <div className="bg-white p-3 rounded border mb-2">
                  <p className="text-sm whitespace-pre-wrap">{post.content}</p>
                  {post.replies && post.replies.length > 0 && (
                    <div className="mt-2 pt-2 border-t">
                      {post.replies.map((reply, i) => (
                        <p key={i} className="text-sm text-gray-600 mt-1">↳ {reply}</p>
                      ))}
                    </div>
                  )}
                </div>

                {post.quality_status === 'failed' && (
                  <div className="bg-red-50 border border-red-200 rounded p-2 mb-2">
                    <p className="text-sm font-medium text-red-800 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      {ui('Quality gate failed')}
                    </p>
                    <ul className="text-xs text-red-700 mt-1">
                      {parseReasons(post.quality_reasons).map((reason: string, i: number) => (
                        <li key={i}>• {reason}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex gap-2">
                  {post.status === 'draft' ? (
                    <button
                      onClick={() => handleApprove(post.id)}
                      disabled={posting === post.id}
                      className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                    >
                      {posting === post.id && <RefreshCw className="w-4 h-4 animate-spin" />}
                      <Send className="w-4 h-4" /> {ui('Post')}
                    </button>
                  ) : <span className="px-3 py-1 text-sm rounded bg-blue-100 text-blue-800">{locale === 'en' ? 'On Schedule' : 'Terjadwal'}</span>}
                  <button
                    onClick={() => handleDelete(post.id)}
                    className="px-3 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50"
                  >
                    {ui('Delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {failedPosts.length > 0 && (
        <div className="mb-6 hidden">
          <h2 className="font-semibold text-lg mb-3">{ui('Failed')} ({failedPosts.length})</h2>
          <div className="space-y-4">
            {failedPosts.map((post) => (
              <div key={post.id} className="border border-red-200 rounded-lg p-4 bg-red-50">
                <div className="flex justify-between items-start gap-3 mb-2">
                  <div>
                    <span className="text-sm font-medium">{post.pillar}</span>
                    <span className="text-xs text-gray-500 ml-2">({post.post_type})</span>
                  </div>
                  <span className="text-xs px-2 py-1 rounded bg-red-100 text-red-800">{post.quality_status === 'failed' ? ui('Quality gate failed') : (locale === 'en' ? 'Upload failed' : 'Upload gagal')}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap mb-3">{post.content}</p>
                {post.quality_status === 'failed' && parseReasons(post.quality_reasons).length > 0 && (
                  <p className="text-xs text-red-700 mb-3">{parseReasons(post.quality_reasons).join(' · ')}</p>
                )}
                {post.status === 'failed' && (
                  <button
                    onClick={() => handleRetry(post.id)}
                    disabled={posting === post.id}
                    className="flex items-center gap-1 px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                  >
                    {posting === post.id && <RefreshCw className="w-4 h-4 animate-spin" />}
                    <RefreshCw className="w-4 h-4" /> {ui('Retry upload')}{post.retry_count > 0 ? ` (${post.retry_count})` : ''}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All posts */}
      <div>
        <h2 className="font-semibold text-lg mb-3">{locale === 'en' ? 'All Posts' : 'Semua Post'}</h2>
        <div className="space-y-3">
          {posts.length === 0 ? (
            <p className="text-gray-500">{ui('No posts yet')}</p>
          ) : (
            paginatedPosts.map((post) => (
              <div key={post.id} className="border rounded-lg p-3 bg-white">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{post.pillar}</span>
                      <span className="text-xs text-gray-500">({post.post_type})</span>
                      <span className={`text-xs px-2 py-1 rounded ${getStatusColor(post.status)}`}>
                        {labelForStatus(locale, post.status)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 line-clamp-2">{post.content}</p>
                    {post.threads_url && (
                      <a
                        href={post.threads_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 mt-1 inline-block"
                      >
                        {ui('View on Threads')}
                      </a>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {post.status === 'draft' && post.quality_status === 'passed' && <button onClick={() => handleApprove(post.id)} disabled={posting === post.id} className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">{posting === post.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{ui('Post')}</button>}
                      {post.status === 'failed' && <button onClick={() => handleRetry(post.id)} disabled={posting === post.id} className="flex items-center gap-1 px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${posting === post.id ? 'animate-spin' : ''}`} />{ui('Retry upload')}{post.retry_count > 0 ? ` (${post.retry_count})` : ''}</button>}
                      <button onClick={() => handleDelete(post.id)} className="px-3 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50">{ui('Delete')}</button>
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 ml-2">
                    {new Date(post.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        {posts.length > 0 && (
          <nav className="mt-3 flex items-center justify-between border-t pt-3" aria-label="Posts pagination">
            <button type="button" onClick={() => setPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40">{ui('Previous')}</button>
            <span className="text-sm text-gray-600">{ui('Page {page} of {total}', { page: currentPage, total: totalPages })}</span>
            <button type="button" onClick={() => setPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages} className="rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40">{ui('Next')}</button>
          </nav>
        )}
      </div>
    </div>
  );
}
