'use client';

import { useCallback, useEffect, useState } from 'react';
import { Calendar, FileText, BarChart3, Settings, Activity } from 'lucide-react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { labelForStatus, translateUi } from '@/lib/ui-translations';

interface ScheduleSlot { id: number; slot_time: number; status: string; post_status?: string; content?: string; quality_status?: string }
interface RecentPost { id: number; pillar: string; post_type: string; status: string; content: string; created_at: number; posted_at: number | null }

export default function DashboardPage() {
  const { locale } = useI18n();
  const ui = (key: string, vars?: Record<string, string | number>) => translateUi(locale, key, vars);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [posts, setPosts] = useState<RecentPost[]>([]);
  const [totalViews, setTotalViews] = useState(0);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);

  const fetchData = useCallback(async () => {
    const [sRes, slotRes, postRes, analyticsRes] = await Promise.all([
      fetch('/api/settings'),
      fetch('/api/settings?action=scheduler_status'),
      fetch('/api/posts'),
      fetch('/api/analytics?page=1'),
    ]);

    const sData = await sRes.json();
    const slotData = await slotRes.json();
    const postData = await postRes.json();
    const analyticsData = await analyticsRes.json();

    setSettings(sData.settings || {});
    setSlots(slotData.slots || []);
    setPosts(postData.posts || []);
    setTotalViews(analyticsData.recentMetricsTotals?.views || 0);
    setNow(Date.now());
    setLoading(false);
  }, []);

  const stats = [
    { icon: Calendar, label: ui('Scheduled Today'), value: slots.filter(s => {
      const timezone = settings.timezone || 'UTC';
      const dateKey = (value: number) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
      return dateKey(s.slot_time) === dateKey(now);
    }).length.toString() },
    { icon: FileText, label: ui('Total Posts'), value: posts.length.toString() },
    { icon: BarChart3, label: ui('Posted'), value: posts.filter(p => p.status === 'posted').length.toString() },
    { icon: Settings, label: ui('Kill Switch'), value: settings.kill_switch === 'true' ? 'ON' : 'OFF' },
    { icon: Activity, label: ui('Mode'), value: settings.posting_mode === 'auto' ? ui('Auto-post') : ui('Draft (approval required)') },
    { icon: BarChart3, label: ui('Total Views'), value: totalViews.toLocaleString(locale === 'en' ? 'en-US' : 'id-ID') },
  ];

  const formatScheduleTime = (value: number) => new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'id-ID', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: settings.timezone || 'UTC',
  }).format(new Date(value));
  const displaySlotStatus = (slot: ScheduleSlot) => slot.post_status === 'failed' || slot.quality_status === 'failed'
    ? 'failed'
    : slot.status === 'pending' && slot.content && slot.quality_status === 'passed' ? 'On Schedule' : slot.status;
  const slotStatusTone = (slot: ScheduleSlot) => {
    const status = displaySlotStatus(slot);
    return status === 'On Schedule' || status === 'completed' ? 'bg-green-100 text-green-800'
      : status === 'pending' ? 'bg-yellow-100 text-yellow-800'
      : ['preparing', 'processing', 'retrying'].includes(status) ? 'bg-blue-100 text-blue-800'
      : 'bg-red-100 text-red-800';
  };

  useEffect(() => {
    const initial = setTimeout(() => { void fetchData(); }, 0);
    const interval = setInterval(() => { void fetchData(); }, 30000);
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, [fetchData]);

  if (loading) return <div className="p-6">{ui('Loading...')}</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">{ui('dashboard')}</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="bg-white p-4 rounded-lg border">
            <div className="flex items-center gap-3">
              <s.icon className="w-5 h-5 text-gray-500" />
              <div>
                <p className="text-sm text-gray-500">{s.label}</p>
                <p className="text-xl font-bold">{s.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Settings */}
      <div className="bg-white rounded-lg border p-4 mb-6">
        <h2 className="font-semibold mb-3">{ui('Quick Settings')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-sm text-gray-500">{ui('Posts per day')}</label>
            <p className="font-medium">{settings.posts_per_day || '3'}</p>
          </div>
          <div>
            <label className="text-sm text-gray-500">{ui('Active hours')}</label>
            <p className="font-medium">{settings.active_hours_start || '8'}:00 - {settings.active_hours_end || '20'}:00</p>
          </div>
          <div>
            <label className="text-sm text-gray-500">{ui('Timezone')}</label>
            <p className="font-medium">{settings.timezone || 'UTC'}</p>
          </div>
        </div>
        <Link
          href="/dashboard/settings"
          className="text-blue-600 text-sm mt-3 inline-block"
        >
          {ui('Edit settings →')}
        </Link>
      </div>

      {/* Upcoming schedule */}
      <div className="bg-white rounded-lg border p-4 mb-6">
        <h2 className="font-semibold mb-3">{ui('Upcoming Schedule')}</h2>
        {slots.length === 0 ? (
          <p className="text-gray-500 text-sm">{ui('No upcoming slots')}</p>
        ) : (
          <div className="space-y-2">
            {slots.filter(slot => slot.slot_time > now).slice(0, 5).map((slot) => (
              <div key={slot.id} className="flex justify-between items-center py-2 border-b last:border-0">
                <div>
                  <span className="font-medium">{formatScheduleTime(slot.slot_time)}</span>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${slotStatusTone(slot)}`}>
                  {labelForStatus(locale, displaySlotStatus(slot))}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent posts */}
      <div className="bg-white rounded-lg border p-4">
        <h2 className="font-semibold mb-3">{ui('Recent Posts')}</h2>
        {posts.length === 0 ? (
          <p className="text-gray-500 text-sm">{ui('No posts yet')}</p>
        ) : (
          <div className="space-y-3">
            {posts.slice(0, 5).map((post) => (
              <div key={post.id} className="border-b pb-2 last:border-0">
                <div className="flex justify-between">
                  <span className="text-sm font-medium">
                    {post.pillar} · {post.post_type}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded ${
                    post.status === 'posted' ? 'bg-green-100 text-green-800' :
                    post.status === 'draft' ? 'bg-yellow-100 text-yellow-800' :
                    post.status === 'quality_failed' ? 'bg-red-100 text-red-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {labelForStatus(locale, post.status)}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                  {post.content?.slice(0, 100)}...
                </p>
                {post.posted_at && (
                  <p className="text-xs text-gray-400 mt-1">
                    {ui('Posted')}: {new Date(post.posted_at).toLocaleString(locale === 'en' ? 'en-US' : 'id-ID')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        <Link
          href="/dashboard/posts"
          className="text-blue-600 text-sm mt-3 inline-block"
        >
          {ui('View all posts →')}
        </Link>
      </div>
    </div>
  );
}
