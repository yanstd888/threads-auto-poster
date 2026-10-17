'use client';

import { useEffect, useState } from 'react';
import { Calendar, Clock, PauseCircle, PlayCircle } from 'lucide-react';

interface Slot {
  id: number;
  slot_time: number;
  pillar: string;
  post_type: string;
  status: string;
  post_id?: number;
  post_status?: string;
  content?: string;
  replies?: string;
  source_urls?: string;
  quality_status?: string;
  retry_count?: number;
  retry_at?: number;
  last_error?: string;
}

interface AgentStatus {
  active: boolean;
  running: boolean;
  phase: 'inactive' | 'preparing' | 'queued' | 'idle';
  preparing?: { id: number; pillar: string; post_type: string; slot_time: number } | null;
  queued: number;
  ready: number;
  latest?: { action: string; details: string; created_at: number } | null;
}

const displayStatus = (slot: Slot) => slot.post_status === 'failed' || slot.quality_status === 'failed'
  ? 'failed'
  : slot.status === 'pending' && slot.content && slot.quality_status === 'passed' ? 'On Schedule' : slot.status;
const PAGE_SIZE = 10;
const parseReplies = (value?: string): string[] => {
  try {
    const replies: unknown = JSON.parse(value || '[]');
    return Array.isArray(replies) ? replies.filter((reply): reply is string => typeof reply === 'string' && Boolean(reply.trim())) : [];
  } catch {
    return [];
  }
};
const statusTone = (slot: Slot) => {
  const status = displayStatus(slot);
  return status === 'On Schedule' || status === 'completed' ? 'bg-green-100 text-green-800'
    : status === 'pending' ? 'bg-yellow-100 text-yellow-800'
    : ['preparing', 'processing', 'retrying'].includes(status) ? 'bg-blue-100 text-blue-800'
    : 'bg-red-100 text-red-800';
};

export default function SchedulePage() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [agentChanging, setAgentChanging] = useState(false);
  const [agentError, setAgentError] = useState('');
  const [page, setPage] = useState(1);

  const fetchSlots = async () => {
    const [slotRes, settingRes] = await Promise.all([
      fetch('/api/settings?action=scheduler_status'),
      fetch('/api/settings'),
    ]);
    const slotData = await slotRes.json();
    const settingData = await settingRes.json();
    setSlots(slotData.slots || []);
    setAgent(slotData.agent || null);
    setSettings(settingData.settings || {});
    setLoading(false);
  };

  const toggleKillSwitch = async () => {
    const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'scheduler_toggle' }) });
    const data = await res.json();
    setSettings(prev => ({ ...prev, kill_switch: data.kill_switch }));
  };

  const toggleAgent = async () => {
    setAgentChanging(true);
    setAgentError('');
    try {
      const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'content_agent', enabled: !agent?.active }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengubah status agent');
      setAgent(data);
      await fetchSlots();
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : 'Gagal mengubah status agent');
    } finally {
      setAgentChanging(false);
    }
  };

  const formatTime = (value: number) => new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: settings.timezone || 'Asia/Jakarta',
  }).format(new Date(value));

  const formatDateTime = (value: number) => new Intl.DateTimeFormat('id-ID', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: settings.timezone || 'Asia/Jakarta',
  }).format(new Date(value));

  const formatDateKey = (value: number) => new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: settings.timezone || 'Asia/Jakarta',
  }).format(new Date(value));

  const PILLAR_LABELS = {
    github: 'GitHub',
    ai: 'AI Agent',
    umkm: 'UMKM',
    security: 'Security',
  };

  const renderPreview = (slot: Slot) => {
    if (!slot.content) {
      if (slot.status === 'retrying') return <p className="mt-2 text-sm text-blue-700">Retry otomatis #{slot.retry_count || 1}{slot.retry_at ? ` · mencoba lagi ${formatTime(slot.retry_at)}` : ''}</p>;
      return <p className="mt-2 text-sm text-amber-700">{slot.status === 'preparing' ? 'Agent sedang mengambil source dan membuat konten.' : 'Menunggu antrean agent.'}</p>;
    }
    const replies = parseReplies(slot.replies);
    return (
      <details className="mt-3 rounded border bg-gray-50 p-3 text-sm">
        <summary className="cursor-pointer font-medium">Lihat konten siap tayang · {slot.post_status} · {slot.quality_status}</summary>
        <p className="mt-3 whitespace-pre-wrap text-gray-800">{slot.content}</p>
        {replies.length > 0 && <div className="mt-3 border-l-2 border-gray-300 pl-3 text-xs text-gray-600"><p className="font-medium">Balasan thread ({replies.length})</p>{replies.map((reply, index) => <p key={index} className="mt-2 whitespace-pre-wrap">{reply}</p>)}</div>}
        {slot.post_status === 'publish_unknown' && <p className="mt-3 text-xs text-amber-700">Root mungkin sudah terbit; balasan tidak diulang otomatis agar tidak menduplikasi post.</p>}
      </details>
    );
  };

  useEffect(() => {
    fetchSlots();
    const interval = setInterval(fetchSlots, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div className="p-6">Loading...</div>;

  const todayKey = formatDateKey(Date.now());
  const upcoming = slots.filter(s => s.slot_time > Date.now() && formatDateKey(s.slot_time) !== todayKey);
  const totalPages = Math.max(1, Math.ceil(upcoming.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedUpcoming = upcoming.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const today = slots.filter(s => formatDateKey(s.slot_time) === todayKey);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Schedule</h1>
        <button
          onClick={toggleKillSwitch}
          className={`px-4 py-2 rounded flex items-center gap-2 ${
            settings.kill_switch === 'true'
              ? 'bg-gray-100 text-gray-600'
              : 'bg-green-100 text-green-700'
          }`}
        >
          {settings.kill_switch === 'true' ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
          {settings.kill_switch === 'true' ? 'Kill Switch ON' : 'Kill Switch OFF'}
        </button>
      </div>

      <div className="bg-white rounded-lg border p-4 mb-6">
        <h2 className="font-semibold mb-2">Current Schedule Settings</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Posts per day</span>
            <span className="font-medium ml-2">{settings.posts_per_day || '3'}</span>
          </div>
          <div>
            <span className="text-gray-500">Active hours</span>
            <span className="font-medium ml-2">{settings.active_hours_start || '8'}:00 - {settings.active_hours_end || '20'}:00</span>
          </div>
          <div>
            <span className="text-gray-500">Timezone</span>
            <span className="font-medium ml-2">{settings.timezone || 'Asia/Jakarta'}</span>
          </div>
          <div>
            <span className="text-gray-500">Mode</span>
            <span className="font-medium ml-2">{settings.posting_mode || 'approval'}</span>
          </div>
        </div>
      </div>

      <section className="bg-white rounded-lg border p-4 mb-6" aria-labelledby="agent-status-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${agent?.running ? 'bg-green-500' : agent?.active ? 'bg-amber-500' : 'bg-gray-400'}`} aria-hidden="true" />
              <h2 id="agent-status-title" className="font-semibold">Content Agent · {agent?.running ? 'Working' : agent?.active ? 'Active / Waiting' : 'Inactive'}</h2>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              {agent?.phase === 'preparing' && agent.preparing
                ? `Sedang membuat slot #${agent.preparing.id} · ${PILLAR_LABELS[agent.preparing.pillar as keyof typeof PILLAR_LABELS] || agent.preparing.pillar}`
                : agent?.phase === 'queued' ? 'Aktif, mengerjakan antrean secara serial.'
                : agent?.phase === 'idle' ? 'Aktif, seluruh konten sudah siap.'
                : 'Inactive: agent tidak memulai konten baru. Jadwal dan konten siap tetap tersimpan.'}
            </p>
            <p className="mt-1 text-xs text-gray-500">Ready {agent?.ready ?? 0} · Antrean {agent?.queued ?? 0}{agent?.latest ? ` · Aktivitas terakhir ${formatDateTime(agent.latest.created_at)}` : ''}</p>
            {agentError && <p role="alert" className="mt-2 text-sm text-red-600">{agentError}</p>}
          </div>
          <button
            type="button"
            onClick={toggleAgent}
            disabled={agentChanging}
            aria-pressed={agent?.active || false}
            className={`inline-flex items-center justify-center gap-2 rounded px-4 py-2 text-sm font-medium disabled:opacity-50 ${agent?.active ? 'bg-gray-100 text-gray-700' : 'bg-green-600 text-white'}`}
          >
            {agent?.active ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
            {agentChanging ? 'Memproses...' : agent?.active ? 'Set Inactive' : 'Set Active'}
          </button>
        </div>
      </section>

      <div className="bg-white rounded-lg border mb-6">
        <h2 className="font-semibold text-lg p-4 border-b">Today's Schedule</h2>
        {today.length === 0 ? (
          <p className="text-gray-500 p-4">No slots scheduled for today</p>
        ) : (
          <div className="divide-y">
            {today.map((slot) => (
              <div key={slot.id} className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4 text-gray-400" />
                    <span className="font-medium">{formatTime(slot.slot_time)}</span>
                    <span className="text-sm text-gray-500">
                      {PILLAR_LABELS[slot.pillar as keyof typeof PILLAR_LABELS] || slot.pillar} · {slot.post_type}
                    </span>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${statusTone(slot)}`}>
                    {displayStatus(slot)}
                  </span>
                </div>
                {renderPreview(slot)}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg border">
        <h2 className="font-semibold text-lg p-4 border-b">Upcoming Schedule</h2>
        {upcoming.length === 0 ? (
          <p className="text-gray-500 p-4">No upcoming slots</p>
        ) : (
          <>
            <div className="divide-y">
              {paginatedUpcoming.map((slot) => (
                <div key={slot.id} className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <div>
                        <span className="font-medium">{formatDateTime(slot.slot_time)}</span>
                        <span className="text-sm text-gray-500 block">
                          {PILLAR_LABELS[slot.pillar as keyof typeof PILLAR_LABELS] || slot.pillar} · {slot.post_type}
                        </span>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${statusTone(slot)}`}>
                      {displayStatus(slot)}
                    </span>
                  </div>
                  {renderPreview(slot)}
                </div>
              ))}
            </div>
            <nav className="flex items-center justify-between border-t p-3" aria-label="Pagination schedule">
              <button type="button" onClick={() => setPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40">Sebelumnya</button>
              <span className="text-sm text-gray-600">Halaman {currentPage} dari {totalPages}</span>
              <button type="button" onClick={() => setPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages} className="rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40">Berikutnya</button>
            </nav>
          </>
        )}
      </div>
    </div>
  );
}
