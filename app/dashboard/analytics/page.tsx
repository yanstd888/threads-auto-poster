'use client';

import { useEffect, useState } from 'react';
import { Eye, Heart, MessageCircle, Quote, Repeat2, Share2 } from 'lucide-react';

interface AnalyticsData {
  totals: { all: number; posted: number; pending: number; failed: number };
  byPillar: { pillar: string; count: number; posted_count: number }[];
  byStatus: { status: string; count: number }[];
  recentMetrics: { pillar: string; created_at: number; views: number; likes: number; replies: number; reposts: number; quotes: number; shares: number }[];
  recentMetricsPagination: { page: number; totalPages: number; total: number };
  learning: { minimumSample: number; sample24h: number; hooks: LearningRow[]; formats: LearningRow[] };
}

interface LearningRow { dimension: string; sample_size: number; avg_conversations: number; avg_redistribution: number }

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const fetchData = async () => {
    const res = await fetch(`/api/analytics?page=${page}`);
    const d = await res.json();
    setData(d);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [page]);

  if (loading) return <div className="p-6">Loading...</div>;
  if (!data) return <div className="p-6">No data</div>;

  const PILLAR_LABELS = {
    github: 'GitHub',
    ai: 'AI Agent',
    umkm: 'UMKM',
    security: 'Security',
  };

  const totalEngage = (data.recentMetrics || []).reduce((sum, m) => sum + m.likes + m.replies + m.reposts + m.quotes + m.shares, 0);
  const totalViews = (data.recentMetrics || []).reduce((sum, m) => sum + m.views, 0);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Analytics</h1>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Total Posts</p>
          <p className="text-2xl font-bold">{data.totals.all}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Posted</p>
          <p className="text-2xl font-bold text-green-600">{data.totals.posted}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Pending</p>
          <p className="text-2xl font-bold text-yellow-600">{data.totals.pending}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Failed</p>
          <p className="text-2xl font-bold text-red-600">{data.totals.failed}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Engagement</p>
          <p className="text-2xl font-bold text-blue-600">{totalEngage}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold mb-3">Posts by Pillar</h3>
          <div className="space-3">
            {data.byPillar.map((p) => (
              <div key={p.pillar} className="flex items-center justify-between">
                <span className="text-sm">
                  {PILLAR_LABELS[p.pillar as keyof typeof PILLAR_LABELS] || p.pillar}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{(p.posted_count / p.count * 100).toFixed(0)}%</span>
                  <div className="w-20 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full"
                      style={{ width: `${(p.posted_count / p.count * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold mb-3">Status Distribution</h3>
          <div className="space-3">
            {data.byStatus.map((s) => (
              <div key={s.status} className="flex items-center justify-between">
                <span className="text-sm">{s.status}</span>
                <span className="font-medium">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <LearningCard title="Hook → percakapan" rows={data.learning.hooks} metric="avg_conversations" sample={data.learning.sample24h} minimum={data.learning.minimumSample} />
        <LearningCard title="Format → distribusi" rows={data.learning.formats} metric="avg_redistribution" sample={data.learning.sample24h} minimum={data.learning.minimumSample} />
      </div>

      {data.recentMetrics && data.recentMetrics.length > 0 && (
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold mb-3">Recent Engagement</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left text-xs font-medium text-gray-500 pb-2">Date</th>
                  <th className="text-left text-xs font-medium text-gray-500 pb-2">Pillar</th>
                  <th className="text-right text-xs font-medium text-gray-500 pb-2">
                    <Eye className="w-4 h-4 inline" /> Views
                  </th>
                  <th className="text-right text-xs font-medium text-gray-500 pb-2">
                    <Heart className="w-4 h-4 inline" /> Likes
                  </th>
                  <th className="text-right text-xs font-medium text-gray-500 pb-2">
                    <MessageCircle className="w-4 h-4 inline" /> Replies
                  </th>
                  <th className="text-right text-xs font-medium text-gray-500 pb-2">
                    <Repeat2 className="w-4 h-4 inline" /> Reposts
                  </th>
                  <th className="text-right text-xs font-medium text-gray-500 pb-2">
                    <Quote className="w-4 h-4 inline" /> Quotes
                  </th>
                  <th className="text-right text-xs font-medium text-gray-500 pb-2">
                    <Share2 className="w-4 h-4 inline" /> Shares
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.recentMetrics.map((m, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-2 text-sm">{new Date(m.created_at).toLocaleDateString()}</td>
                    <td className="py-2 text-sm">{PILLAR_LABELS[m.pillar as keyof typeof PILLAR_LABELS] || m.pillar}</td>
                    <td className="py-2 text-sm text-right">{m.views || 0}</td>
                    <td className="py-2 text-sm text-right">{m.likes || 0}</td>
                    <td className="py-2 text-sm text-right">{m.replies || 0}</td>
                    <td className="py-2 text-sm text-right">{m.reposts || 0}</td>
                    <td className="py-2 text-sm text-right">{m.quotes || 0}</td>
                    <td className="py-2 text-sm text-right">{m.shares || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="mt-3 flex items-center justify-between border-t pt-3" aria-label="Pagination recent engagement">
            <button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40">Sebelumnya</button>
            <span className="text-sm text-gray-600">Halaman {data.recentMetricsPagination.page} dari {data.recentMetricsPagination.totalPages}</span>
            <button type="button" onClick={() => setPage(Math.min(data.recentMetricsPagination.totalPages, page + 1))} disabled={page === data.recentMetricsPagination.totalPages} className="rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40">Berikutnya</button>
          </nav>
        </div>
      )}

      {data.recentMetrics && data.recentMetrics.length === 0 && (
        <p className="text-gray-500">No metrics available yet. Metrics will appear after posts get engagement.</p>
      )}
    </div>
  );
}

function LearningCard({ title, rows, metric, sample, minimum }: { title: string; rows: LearningRow[]; metric: 'avg_conversations' | 'avg_redistribution'; sample: number; minimum: number }) {
  return <div className="bg-white rounded-lg border p-4">
    <h3 className="font-semibold mb-1">{title}</h3>
    {sample < minimum ? <p className="text-sm text-gray-500">Belum ada kesimpulan: {sample}/{minimum} snapshot 24 jam.</p> : rows.length === 0 ? <p className="text-sm text-gray-500">Belum ada grup dengan sampel cukup.</p> : <div className="space-y-2">{rows.map(row => <div key={row.dimension} className="flex justify-between text-sm"><span>{row.dimension}</span><span>{row[metric]} rata-rata · n={row.sample_size}</span></div>)}</div>}
  </div>;
}
