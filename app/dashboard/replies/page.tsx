'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Eye, Gauge, MessageCircle, Plus, RefreshCw, Search, ShieldCheck, Trash2, WandSparkles, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

type Tab = 'queue' | 'targets' | 'settings' | 'analytics';
type Target = { id: number; target_type: string; label: string; value: string | null; config: Record<string, unknown>; enabled: boolean; weight: number; last_scanned_at: number | null };
type Candidate = { id: number; target_thread_id: string; target_username: string; target_permalink: string | null; target_text: string; target_topic_tag: string | null; target_posted_at: number | null; target_type: string; target_query: string | null; discovered_at: number; relevance_score: number | null; selection_reason: string | null; risk_flags: string[]; generated_reply: string | null; edited_reply: string | null; reply_language: string | null; reply_mechanism: string | null; reply_reason: string | null; quality_score: number | null; quality_status: string | null; quality_reasons: string[]; status: string; reply_permalink: string | null; retry_count: number; last_error: string | null };
type Settings = Record<string, string>;
type CapabilityReport = { connected: boolean; username?: string; accountId?: string; keywordSearch: { supported: boolean; reason?: string }; profileDiscovery: { supported: boolean; reason?: string }; replyPublishing: { supported: boolean; reason?: string }; replyQuota: { quotaUsage: number; quotaTotal: number; quotaDuration: number; remaining: number } | null; quotaError?: string };
type Analytics = { status: Array<{ status: string; count: number }>; byTarget: Array<Record<string, unknown>>; byMechanism: Array<Record<string, unknown>>; evidenceMinimum: number; snapshots24h: number; rankingEligible: boolean; note: string };

type TargetForm = { target_type: 'account' | 'keyword' | 'topic' | 'community_bundle' | 'free'; label: string; value: string; weight: string; config: string };
const emptyTargetForm: TargetForm = { target_type: 'keyword', label: '', value: '', weight: '1', config: '{}' };

export default function ReplyAgentPage() {
  const { locale } = useI18n();
  const id = locale === 'id';
  const [tab, setTab] = useState<Tab>('queue');
  const [settings, setSettings] = useState<Settings>({});
  const [status, setStatus] = useState<Record<string, unknown>>({});
  const [targets, setTargets] = useState<Target[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityReport | null>(null);
  const [preview, setPreview] = useState<Array<{ id: string; username: string; text: string; permalink?: string; targetLabel: string; query: string }>>([]);
  const [targetForm, setTargetForm] = useState<TargetForm>(emptyTargetForm);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const copy = useCallback((indonesian: string, english: string) => id ? indonesian : english, [id]);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsResponse, targetsResponse, candidatesResponse, analyticsResponse] = await Promise.all([
        fetch('/api/reply-agent/settings'),
        fetch('/api/reply-agent/targets'),
        fetch('/api/reply-agent/candidates?limit=100'),
        fetch('/api/reply-agent/analytics'),
      ]);
      const [settingsData, targetsData, candidatesData, analyticsData] = await Promise.all([
        readResponse<{ settings: Settings; status: Record<string, unknown>; capabilities: CapabilityReport | null }>(settingsResponse),
        readResponse<{ targets: Target[] }>(targetsResponse),
        readResponse<{ candidates: Candidate[] }>(candidatesResponse),
        readResponse<Analytics>(analyticsResponse),
      ]);
      setSettings(settingsData.settings || {});
      setStatus(settingsData.status || {});
      setCapabilities(settingsData.capabilities || null);
      setTargets(targetsData.targets || []);
      setCandidates(candidatesData.candidates || []);
      setAnalytics(analyticsData);
    } catch (error: unknown) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : copy('Gagal memuat Reply Agent', 'Failed to load Reply Agent') });
    } finally {
      setLoading(false);
    }
  }, [copy]);

  useEffect(() => { const timer = setTimeout(() => { void refresh(); }, 0); return () => clearTimeout(timer); }, [refresh]);

  const runAction = async (key: string, url: string, init?: RequestInit) => {
    setBusy(key);
    setMessage(null);
    try {
      await readResponse(await fetch(url, init));
      setMessage({ tone: 'ok', text: copy('Perubahan tersimpan.', 'Changes saved.') });
      await refresh();
    } catch (error: unknown) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : copy('Aksi gagal.', 'Action failed.') });
    } finally {
      setBusy(null);
    }
  };

  const setReplySetting = async (key: string, value: string, confirmAuto = false) => {
    await runAction(`setting:${key}`, '/api/reply-agent/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value, confirmAuto }) });
  };

  const previewDiscovery = async () => {
    setBusy('preview');
    setPreview([]);
    try {
      const data = await readResponse<{ posts: typeof preview }>(await fetch('/api/reply-agent/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preview: true }) }));
      setPreview(data.posts || []);
      setMessage({ tone: 'ok', text: copy(`${data.posts?.length || 0} post ditemukan untuk preview.`, `${data.posts?.length || 0} posts found for preview.`) });
    } catch (error: unknown) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : copy('Preview discovery gagal.', 'Discovery preview failed.') });
    } finally { setBusy(null); }
  };

  const addTarget = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy('target:add');
    try {
      let config: unknown = {};
      try { config = JSON.parse(targetForm.config || '{}'); } catch { throw new Error(copy('Config harus JSON valid.', 'Config must be valid JSON.')); }
      await readResponse(await fetch('/api/reply-agent/targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...targetForm, weight: Number(targetForm.weight), config }) }));
      setTargetForm(emptyTargetForm);
      setMessage({ tone: 'ok', text: copy('Target ditambahkan.', 'Target added.') });
      await refresh();
    } catch (error: unknown) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : copy('Target gagal ditambahkan.', 'Target could not be added.') });
    } finally { setBusy(null); }
  };

  const editCandidate = async (candidate: Candidate) => {
    const replyText = edits[candidate.id] ?? candidate.edited_reply ?? candidate.generated_reply ?? '';
    await runAction(`edit:${candidate.id}`, `/api/reply-agent/candidates/${candidate.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replyText }) });
  };

  const candidateAction = async (candidate: Candidate, action: 'generate' | 'approve' | 'reject' | 'retry' | 'publish') => {
    if (action === 'reject' && !window.confirm(copy('Tolak candidate ini?', 'Reject this candidate?'))) return;
    await runAction(`${action}:${candidate.id}`, `/api/reply-agent/candidates/${candidate.id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'reject' ? { reason: 'operator_rejected' } : {}) });
  };

  const setMode = async (value: string) => {
    const confirmAuto = value === 'auto' && window.confirm(copy('Auto mode dapat mem-publish reply setelah approval konfigurasi. Lanjutkan?', 'Auto mode may publish replies after configuration approval. Continue?'));
    if (value === 'auto' && !confirmAuto) return;
    await setReplySetting('reply_posting_mode', value, confirmAuto);
    if (value === 'auto' && confirmAuto) await setReplySetting('reply_auto_mode_approved', 'true', true);
  };

  const activeTargets = useMemo(() => targets.filter(target => target.enabled && target.weight > 0).length, [targets]);
  const counts = (status.counts || {}) as Record<string, number>;

  if (loading) return <div className="p-6" role="status">{copy('Memuat Reply Agent…', 'Loading Reply Agent…')}</div>;

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.2em]">{copy('Reply Agent', 'Reply Agent')}</p>
          <h1 className="text-3xl font-black">{copy('Balas dengan konteks, bukan spam.', 'Reply with context, not spam.')}</h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-700">{copy('Fokus akun: membantu UMKM dan builder memakai AI, automation, dan website agar bekerja lebih cepat dan menghasilkan lebih banyak.', 'Positioning: help SMBs and builders use AI, automation, and websites to work faster and produce more.')}</p>
        </div>
        <div className={`border-2 border-black px-3 py-2 text-sm font-bold ${status.enabled ? 'bg-green-200' : 'bg-yellow-200'}`}>
          {status.enabled ? copy('Agent aktif', 'Agent enabled') : copy('Agent mati secara default', 'Agent disabled by default')}
          <span className="ml-2 font-normal">· {String(status.postingMode || 'approval')}</span>
        </div>
      </div>

      {message ? <div role="alert" className={`mb-4 flex items-center gap-2 border-2 border-black px-3 py-2 text-sm ${message.tone === 'ok' ? 'bg-green-100' : 'bg-red-100'}`}><AlertTriangle className="h-4 w-4" />{message.text}</div> : null}

      <div className="mb-5 flex flex-wrap gap-2 border-b-2 border-black pb-2" role="tablist" aria-label={copy('Reply Agent', 'Reply Agent')}>
        {([['queue', copy('Antrean', 'Queue')], ['targets', copy('Target', 'Targets')], ['settings', copy('Kontrol', 'Controls')], ['analytics', copy('Analitik', 'Analytics')]] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`border-2 border-black px-3 py-2 text-sm font-bold ${tab === key ? 'bg-black text-white' : 'bg-white text-black'}`}>{label}</button>)}
      </div>

      {tab === 'queue' ? <QueueTab candidates={candidates} counts={counts} edits={edits} setEdits={setEdits} busy={busy} onAction={candidateAction} onEdit={editCandidate} onPreview={previewDiscovery} onDiscover={() => runAction('discover', '/api/reply-agent/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })} preview={preview} copy={copy} /> : null}
      {tab === 'targets' ? <TargetsTab targets={targets} targetForm={targetForm} setTargetForm={setTargetForm} busy={busy} onAdd={addTarget} onToggle={(target) => runAction(`target:${target.id}`, '/api/reply-agent/targets', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: target.id, enabled: !target.enabled }) })} onDelete={(target) => { if (window.confirm(copy('Nonaktifkan target ini?', 'Disable this target?'))) void runAction(`target-delete:${target.id}`, '/api/reply-agent/targets', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: target.id }) }); }} copy={copy} /> : null}
      {tab === 'settings' ? <SettingsTab settings={settings} status={status} capabilities={capabilities} activeTargets={activeTargets} busy={busy} onSet={setReplySetting} onMode={setMode} onProbe={async () => { setBusy('probe'); try { const data = await readResponse<{ capabilities: CapabilityReport }>(await fetch('/api/reply-agent/settings?probe=1')); setCapabilities(data.capabilities); setMessage({ tone: 'ok', text: copy('Capability probe selesai.', 'Capability probe completed.') }); } catch (error: unknown) { setMessage({ tone: 'error', text: error instanceof Error ? error.message : copy('Probe gagal.', 'Probe failed.') }); } finally { setBusy(null); } }} copy={copy} /> : null}
      {tab === 'analytics' ? <AnalyticsTab analytics={analytics} busy={busy} onSync={() => runAction('metrics', '/api/reply-agent/analytics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })} copy={copy} /> : null}
    </div>
  );
}

function QueueTab({ candidates, counts, edits, setEdits, busy, onAction, onEdit, onPreview, onDiscover, preview, copy }: { candidates: Candidate[]; counts: Record<string, number>; edits: Record<number, string>; setEdits: React.Dispatch<React.SetStateAction<Record<number, string>>>; busy: string | null; onAction: (candidate: Candidate, action: 'generate' | 'approve' | 'reject' | 'retry' | 'publish') => void; onEdit: (candidate: Candidate) => void; onPreview: () => void; onDiscover: () => void; preview: Array<{ id: string; username: string; text: string; permalink?: string; targetLabel: string; query: string }>; copy: (a: string, b: string) => string }) {
  return <>
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
      {['discovered', 'draft', 'approved', 'posted', 'publish_unknown'].map(key => <div key={key} className="border-2 border-black bg-white p-3"><p className="text-xs font-bold uppercase">{key}</p><p className="text-2xl font-black">{counts[key] || 0}</p></div>)}
    </div>
    <div className="mb-5 flex flex-wrap gap-2">
      <button type="button" onClick={onPreview} disabled={busy === 'preview'} className="flex items-center gap-2 border-2 border-black bg-white px-3 py-2 text-sm font-bold disabled:opacity-50"><Eye className="h-4 w-4" />{copy('Preview discovery', 'Preview discovery')}</button>
      <button type="button" onClick={onDiscover} disabled={busy === 'discover'} className="flex items-center gap-2 border-2 border-black bg-yellow-300 px-3 py-2 text-sm font-bold disabled:opacity-50"><Search className="h-4 w-4" />{copy('Jalankan discovery', 'Run discovery')}</button>
    </div>
    {preview.length > 0 ? <section className="mb-6 border-2 border-dashed border-black bg-yellow-50 p-4"><h2 className="mb-3 font-black">{copy('Preview read-only', 'Read-only preview')}</h2><div className="space-y-2">{preview.slice(0, 12).map(item => <article key={item.id} className="border border-black bg-white p-3"><div className="flex justify-between gap-3 text-xs font-bold"><span>@{item.username} · {item.targetLabel}</span><span>{item.query}</span></div><p className="mt-2 text-sm">{item.text}</p></article>)}</div></section> : null}
    <section className="space-y-4">
      <h2 className="text-xl font-black">{copy('Candidate queue', 'Candidate queue')}</h2>
      {candidates.length === 0 ? <div className="border-2 border-black bg-white p-8 text-center"><MessageCircle className="mx-auto mb-2 h-8 w-8" /><p className="font-bold">{copy('Belum ada candidate. Preview dulu sebelum menyalakan agent.', 'No candidates yet. Preview before enabling the agent.')}</p></div> : candidates.map(candidate => {
        const reply = edits[candidate.id] ?? candidate.edited_reply ?? candidate.generated_reply ?? '';
        const canEdit = ['draft', 'quality_failed'].includes(candidate.status);
        return <article key={candidate.id} className="border-2 border-black bg-white p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><p className="font-black">@{candidate.target_username} <span className="font-normal text-gray-600">· {candidate.target_type} · {candidate.target_query || '—'}</span></p><p className="text-xs text-gray-600">{candidate.target_posted_at ? new Date(candidate.target_posted_at).toLocaleString() : copy('Waktu tidak tersedia', 'Timestamp unavailable')}</p></div><div className="flex flex-wrap gap-1 text-xs font-bold"><span className="border border-black px-2 py-1">{candidate.status}</span>{candidate.relevance_score != null ? <span className="border border-black bg-green-100 px-2 py-1">score {candidate.relevance_score}</span> : null}{candidate.quality_status ? <span className={`border border-black px-2 py-1 ${candidate.quality_status === 'passed' ? 'bg-green-100' : 'bg-red-100'}`}>{candidate.quality_status}</span> : null}</div></div>
          <p className="mb-3 border-l-4 border-black pl-3 text-sm leading-6">{candidate.target_text}</p>
          {candidate.target_permalink ? <a href={candidate.target_permalink} target="_blank" rel="noopener noreferrer" className="mb-3 inline-flex items-center gap-1 text-xs font-bold underline"><ExternalLink className="h-3 w-3" />{copy('Buka post target', 'Open target post')}</a> : null}
          {candidate.quality_reasons.length > 0 ? <div className="mb-3 border border-red-700 bg-red-50 p-2 text-xs text-red-800"><strong>{copy('Alasan quality/risk:', 'Quality/risk reasons:')}</strong> {candidate.quality_reasons.join(' · ')}</div> : null}
          {candidate.last_error ? <p className="mb-3 text-xs text-red-700">{candidate.last_error}</p> : null}
          {canEdit ? <textarea aria-label={copy('Draft reply', 'Reply draft')} value={reply} onChange={event => setEdits(prev => ({ ...prev, [candidate.id]: event.target.value }))} className="mb-3 min-h-24 w-full border-2 border-black p-3 text-sm" placeholder={copy('Generate atau tulis reply…', 'Generate or write a reply…')} /> : reply ? <p className="mb-3 border-2 border-black bg-gray-50 p-3 text-sm">{reply}</p> : null}
          <div className="flex flex-wrap gap-2">{['discovered', 'scored', 'failed', 'quality_failed'].includes(candidate.status) ? <button type="button" onClick={() => onAction(candidate, 'generate')} disabled={busy === `generate:${candidate.id}`} className="flex items-center gap-1 border-2 border-black bg-blue-200 px-3 py-2 text-xs font-bold disabled:opacity-50"><WandSparkles className="h-3 w-3" />{copy('Generate', 'Generate')}</button> : null}{canEdit ? <button type="button" onClick={() => onEdit(candidate)} disabled={busy === `edit:${candidate.id}`} className="flex items-center gap-1 border-2 border-black bg-white px-3 py-2 text-xs font-bold disabled:opacity-50"><Check className="h-3 w-3" />{copy('Simpan edit', 'Save edit')}</button> : null}{candidate.status === 'draft' && candidate.quality_status === 'passed' ? <button type="button" onClick={() => onAction(candidate, 'approve')} disabled={busy === `approve:${candidate.id}`} className="border-2 border-black bg-green-300 px-3 py-2 text-xs font-bold disabled:opacity-50">{copy('Approve', 'Approve')}</button> : null}{candidate.status === 'approved' ? <button type="button" onClick={() => onAction(candidate, 'publish')} disabled={busy === `publish:${candidate.id}`} className="border-2 border-black bg-pink-300 px-3 py-2 text-xs font-bold disabled:opacity-50">{copy('Publish reply', 'Publish reply')}</button> : null}{!['posted', 'publishing', 'publish_unknown', 'rejected'].includes(candidate.status) ? <button type="button" onClick={() => onAction(candidate, 'reject')} disabled={busy === `reject:${candidate.id}`} className="flex items-center gap-1 border-2 border-black bg-white px-3 py-2 text-xs font-bold disabled:opacity-50"><X className="h-3 w-3" />{copy('Reject', 'Reject')}</button> : null}{['failed', 'quality_failed'].includes(candidate.status) ? <button type="button" onClick={() => onAction(candidate, 'retry')} disabled={busy === `retry:${candidate.id}`} className="flex items-center gap-1 border-2 border-black bg-yellow-200 px-3 py-2 text-xs font-bold disabled:opacity-50"><RefreshCw className="h-3 w-3" />{copy('Manual retry', 'Manual retry')}</button> : null}</div>
          {candidate.status === 'publish_unknown' ? <p className="mt-3 border-2 border-amber-700 bg-amber-50 p-2 text-xs font-bold text-amber-900">{copy('Publish tidak pasti. Verifikasi di Threads sebelum tindakan manual; retry otomatis dilarang.', 'Publish status is unknown. Verify on Threads before manual action; automatic retry is disabled.')}</p> : null}
          {candidate.status === 'posted' && candidate.reply_permalink ? <a href={candidate.reply_permalink} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-bold underline"><ExternalLink className="h-3 w-3" />{copy('Buka reply terverifikasi', 'Open verified reply')}</a> : null}
        </article>;
      })}
    </section>
  </>;
}

function TargetsTab({ targets, targetForm, setTargetForm, busy, onAdd, onToggle, onDelete, copy }: { targets: Target[]; targetForm: TargetForm; setTargetForm: React.Dispatch<React.SetStateAction<TargetForm>>; busy: string | null; onAdd: (event: React.FormEvent) => void; onToggle: (target: Target) => void; onDelete: (target: Target) => void; copy: (a: string, b: string) => string }) {
  return <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
    <form onSubmit={onAdd} className="border-2 border-black bg-white p-4"><h2 className="mb-4 text-xl font-black">{copy('Tambah target', 'Add target')}</h2><div className="space-y-3"><label className="block text-sm font-bold">{copy('Jenis', 'Type')}<select value={targetForm.target_type} onChange={event => setTargetForm(prev => ({ ...prev, target_type: event.target.value as TargetForm['target_type'] }))} className="mt-1 w-full border-2 border-black p-2"><option value="keyword">keyword</option><option value="topic">topic</option><option value="account">account</option><option value="community_bundle">community bundle</option><option value="free">free</option></select></label><label className="block text-sm font-bold">{copy('Label', 'Label')}<input required value={targetForm.label} onChange={event => setTargetForm(prev => ({ ...prev, label: event.target.value }))} className="mt-1 w-full border-2 border-black p-2" /></label><label className="block text-sm font-bold">{copy('Nilai / username', 'Value / username')}<input value={targetForm.value} onChange={event => setTargetForm(prev => ({ ...prev, value: event.target.value }))} className="mt-1 w-full border-2 border-black p-2" placeholder="website atau username" /></label><label className="block text-sm font-bold">{copy('Bobot target', 'Target weight')}<input type="number" min="0" max="1000" value={targetForm.weight} onChange={event => setTargetForm(prev => ({ ...prev, weight: event.target.value }))} className="mt-1 w-full border-2 border-black p-2" /></label><label className="block text-sm font-bold">Config JSON<textarea value={targetForm.config} onChange={event => setTargetForm(prev => ({ ...prev, config: event.target.value }))} className="mt-1 min-h-24 w-full border-2 border-black p-2 font-mono text-xs" placeholder={'{"language":"id"}'} /></label><button type="submit" disabled={busy === 'target:add'} className="flex items-center gap-2 border-2 border-black bg-yellow-300 px-3 py-2 text-sm font-bold disabled:opacity-50"><Plus className="h-4 w-4" />{copy('Tambah target', 'Add target')}</button></div></form>
    <section><div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-black">{copy('Target aktif', 'Active targets')}</h2><span className="text-sm">{targets.filter(target => target.enabled && target.weight > 0).length} / {targets.length}</span></div><div className="space-y-3">{targets.length === 0 ? <div className="border-2 border-black bg-white p-6">{copy('Belum ada target.', 'No targets yet.')}</div> : targets.map(target => <article key={target.id} className="border-2 border-black bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black">{target.label}</p><p className="text-xs text-gray-600">{target.target_type} · {target.value || 'seed dari pillar'} · weight {target.weight}</p><p className="mt-1 text-xs">{target.enabled && target.weight > 0 ? copy('Aktif untuk discovery', 'Active for discovery') : copy('Tidak dipakai discovery', 'Excluded from discovery')}</p></div><div className="flex gap-2"><button type="button" onClick={() => onToggle(target)} disabled={busy === `target:${target.id}`} className="border-2 border-black px-2 py-1 text-xs font-bold">{target.enabled ? copy('Matikan', 'Disable') : copy('Aktifkan', 'Enable')}</button><button type="button" onClick={() => onDelete(target)} disabled={busy === `target-delete:${target.id}`} aria-label={copy('Nonaktifkan target', 'Disable target')} className="border-2 border-black bg-red-100 px-2 py-1"><Trash2 className="h-4 w-4" /></button></div></div><p className="mt-3 text-xs text-gray-600">{target.last_scanned_at ? `${copy('Scan terakhir', 'Last scan')}: ${new Date(target.last_scanned_at).toLocaleString()}` : copy('Belum pernah discan', 'Not scanned yet')}</p></article>)}</div></section>
  </div>;
}

function SettingsTab({ settings, status, capabilities, activeTargets, busy, onSet, onMode, onProbe, copy }: { settings: Settings; status: Record<string, unknown>; capabilities: CapabilityReport | null; activeTargets: number; busy: string | null; onSet: (key: string, value: string, confirmAuto?: boolean) => void; onMode: (value: string) => void; onProbe: () => void; copy: (a: string, b: string) => string }) {
  const numeric = [['reply_daily_max', copy('Maksimum reply per hari', 'Daily reply maximum')], ['reply_unique_accounts_daily_max', copy('Maksimum akun unik per hari', 'Daily unique target accounts')], ['reply_per_account_daily_max', copy('Maksimum per akun per hari', 'Per-target-account daily maximum')], ['reply_min_gap_minutes', copy('Cooldown menit', 'Cooldown minutes')], ['reply_discovery_interval_minutes', copy('Interval discovery menit', 'Discovery interval minutes')], ['reply_max_post_age_hours', copy('Umur post maksimum jam', 'Maximum post age hours')], ['reply_relevance_threshold', copy('Threshold relevance', 'Relevance threshold')], ['reply_auto_score_threshold', copy('Threshold auto mode', 'Auto-mode score threshold')]] as const;
  return <div className="space-y-5"><section className="border-2 border-black bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black">{copy('Kontrol aman', 'Safety controls')}</h2><p className="mt-1 text-sm text-gray-700">{copy('Approval adalah default. Global kill switch tetap menjadi batas terakhir.', 'Approval is the default. The global kill switch remains the final boundary.')}</p></div><button type="button" onClick={() => onSet('reply_agent_enabled', settings.reply_agent_enabled === 'true' ? 'false' : 'true')} disabled={busy === 'setting:reply_agent_enabled' || (settings.reply_agent_enabled !== 'true' && activeTargets === 0)} className={`border-2 border-black px-3 py-2 text-sm font-black ${settings.reply_agent_enabled === 'true' ? 'bg-green-300' : 'bg-yellow-200'} disabled:opacity-50`}>{settings.reply_agent_enabled === 'true' ? copy('Matikan agent', 'Disable agent') : copy('Nyalakan agent', 'Enable agent')}</button></div>{settings.reply_agent_enabled !== 'true' && activeTargets === 0 ? <p className="mt-3 text-xs font-bold text-red-700">{copy('Tambahkan target aktif sebelum agent dapat dinyalakan.', 'Add an active target before enabling the agent.')}</p> : null}</section>
    <section className="border-2 border-black bg-white p-4"><h2 className="mb-4 text-xl font-black">{copy('Batas publish', 'Publishing limits')}</h2><div className="grid gap-3 sm:grid-cols-2">{numeric.map(([key, label]) => <label key={key} className="text-sm font-bold">{label}<div className="mt-1 flex gap-2"><input type="number" value={settings[key] || ''} onChange={event => onSet(key, event.target.value)} className="w-full border-2 border-black p-2" /><span className="flex items-center border-2 border-black bg-gray-100 px-2 text-xs">save</span></div></label>)}<label className="text-sm font-bold">{copy('Kebijakan per akun', 'Per-account policy')}<select value={settings.reply_account_policy || 'once'} onChange={event => onSet('reply_account_policy', event.target.value)} className="mt-1 w-full border-2 border-black p-2"><option value="once">{copy('Satu reply total per akun', 'One reply total per account')}</option><option value="continuations_only">{copy('Lanjutan percakapan saja', 'Conversation continuations only')}</option></select></label><label className="text-sm font-bold">{copy('Mode posting', 'Posting mode')}<select value={settings.reply_posting_mode || 'approval'} onChange={event => void onMode(event.target.value)} className="mt-1 w-full border-2 border-black p-2"><option value="approval">approval</option><option value="auto">auto</option></select></label><label className="text-sm font-bold">{copy('Bahasa reply', 'Reply language')}<select value={settings.reply_language_mode || 'match_target'} onChange={event => onSet('reply_language_mode', event.target.value)} className="mt-1 w-full border-2 border-black p-2"><option value="match_target">match target</option><option value="id">Indonesia</option><option value="en">English</option></select></label><label className="text-sm font-bold">{copy('Jam mulai reply', 'Reply start hour')}<input type="number" min="0" max="22" value={settings.reply_active_hours_start || ''} onChange={event => onSet('reply_active_hours_start', event.target.value)} className="mt-1 w-full border-2 border-black p-2" /></label><label className="text-sm font-bold">{copy('Jam selesai reply', 'Reply end hour')}<input type="number" min="1" max="23" value={settings.reply_active_hours_end || ''} onChange={event => onSet('reply_active_hours_end', event.target.value)} className="mt-1 w-full border-2 border-black p-2" /></label></div><div className="mt-4 border-2 border-black bg-yellow-50 p-3 text-sm"><p className="font-bold">{settings.reply_account_policy === 'continuations_only' ? copy('Reply pertama boleh ke post baru. Setelah itu hanya balasan langsung dari akun yang sama ke reply kita yang boleh dibalas.', 'The first reply may target a new post. After that, only a direct reply from the same account to our reply may be answered.') : copy('Akun yang sudah pernah mendapat reply tidak dapat dibalas lagi.', 'An account that has received a reply cannot be replied to again.')}</p>{settings.reply_account_policy === 'continuations_only' ? <p className="mt-2 text-xs">{copy('Naikkan maksimum per akun per hari jika ingin lebih dari satu. Sambungkan ulang Threads dengan izin baca reply sebelum mode ini bisa menemukan lanjutan.', 'Increase the per-account daily maximum to allow more than one. Reconnect Threads with reply-read permission before this mode can discover continuations.')} <a href="/api/auth/threads/connect?reply=1" className="font-bold underline">{copy('Sambungkan ulang Threads', 'Reconnect Threads')}</a></p> : null}</div>{settings.reply_posting_mode === 'auto' ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-2 border-red-700 bg-red-50 p-3"><p className="text-sm font-bold text-red-900">{status.autoModeApproved ? copy('Auto mode disetujui oleh operator.', 'Auto mode approved by operator.') : copy('Auto mode belum disetujui.', 'Auto mode is not approved.')}</p><button type="button" onClick={() => onSet('reply_auto_mode_approved', status.autoModeApproved ? 'false' : 'true', true)} className="border-2 border-black bg-white px-3 py-2 text-xs font-bold">{status.autoModeApproved ? copy('Cabut persetujuan', 'Revoke approval') : copy('Setujui auto mode', 'Approve auto mode')}</button></div> : null}</section>
    <section className="border-2 border-black bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black">{copy('Capability resmi Threads', 'Official Threads capabilities')}</h2><p className="mt-1 text-xs text-gray-600">{copy('Probe hanya berjalan saat tombol ditekan dan tidak publish.', 'The probe runs only when clicked and never publishes.')}</p></div><button type="button" onClick={onProbe} disabled={busy === 'probe'} className="flex items-center gap-2 border-2 border-black bg-white px-3 py-2 text-sm font-bold disabled:opacity-50"><Gauge className="h-4 w-4" />{copy('Probe capability', 'Probe capability')}</button></div>{capabilities ? <div className="mt-4 grid gap-2 sm:grid-cols-2"><Capability label={copy('Koneksi', 'Connection')} ok={capabilities.connected} detail={capabilities.username ? `@${capabilities.username}` : undefined} /><Capability label="Keyword search" ok={capabilities.keywordSearch.supported} detail={capabilities.keywordSearch.reason} /><Capability label="Profile discovery" ok={capabilities.profileDiscovery.supported} detail={capabilities.profileDiscovery.reason} /><Capability label={copy('Reply publish/quota', 'Reply publish/quota')} ok={capabilities.replyPublishing.supported} detail={capabilities.replyQuota ? `${capabilities.replyQuota.remaining} / ${capabilities.replyQuota.quotaTotal}` : capabilities.replyPublishing.reason} /></div> : <p className="mt-4 text-sm text-gray-600">{copy('Belum diprobe.', 'Not probed yet.')}</p>}</section>
  </div>;
}

function Capability({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) { return <div className={`flex items-center justify-between border-2 border-black p-3 text-sm ${ok ? 'bg-green-100' : 'bg-red-100'}`}><span className="flex items-center gap-2 font-bold">{ok ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{label}</span><span className="text-right text-xs">{detail || (ok ? 'supported' : 'blocked')}</span></div>; }

function AnalyticsTab({ analytics, busy, onSync, copy }: { analytics: Analytics | null; busy: string | null; onSync: () => void; copy: (a: string, b: string) => string }) {
  if (!analytics) return <div className="border-2 border-black bg-white p-6">{copy('Belum ada data analitik.', 'No analytics yet.')}</div>;
  return <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black">{copy('Analitik reply', 'Reply analytics')}</h2><p className="text-sm text-gray-700">{analytics.note}</p></div><button type="button" onClick={onSync} disabled={busy === 'metrics'} className="flex items-center gap-2 border-2 border-black bg-white px-3 py-2 text-sm font-bold disabled:opacity-50"><RefreshCw className="h-4 w-4" />{copy('Sync metrics', 'Sync metrics')}</button></div><div className="grid gap-3 sm:grid-cols-3">{analytics.status.map(item => <div key={item.status} className="border-2 border-black bg-white p-3"><p className="text-xs font-bold uppercase">{item.status}</p><p className="text-2xl font-black">{item.count}</p></div>)}</div><div className="border-2 border-black bg-white p-4"><h3 className="mb-3 font-black">{copy('Bukti ranking', 'Ranking evidence')}</h3><p className="text-sm">{analytics.snapshots24h} / {analytics.evidenceMinimum} {copy('snapshot 24 jam', '24-hour snapshots')} · {analytics.rankingEligible ? copy('cukup untuk tie-breaker', 'enough for tie-breaker') : copy('belum boleh ranking', 'ranking not allowed yet')}</p></div><div className="grid gap-5 lg:grid-cols-2"><AnalyticsTable title={copy('Per target', 'By target')} rows={analytics.byTarget} copy={copy} /><AnalyticsTable title={copy('Per mekanisme', 'By mechanism')} rows={analytics.byMechanism} copy={copy} /></div></div>;
}

function AnalyticsTable({ title, rows, copy }: { title: string; rows: Array<Record<string, unknown>>; copy: (a: string, b: string) => string }) { return <section className="border-2 border-black bg-white p-4"><h3 className="mb-3 font-black">{title}</h3>{rows.length === 0 ? <p className="text-sm text-gray-600">{copy('Belum ada post terverifikasi.', 'No verified posts yet.')}</p> : <div className="space-y-2">{rows.map((row, index) => <div key={index} className="border border-black p-3 text-sm"><div className="flex justify-between gap-3 font-bold"><span>{String(row.target_username || row.mechanism || 'unknown')}</span><span>{String(row.posted || 0)} posted</span></div><p className="mt-1 text-xs text-gray-600">relevance {formatValue(row.avg_relevance)} · views {formatValue(row.avg_views)}</p></div>)}</div>}</section>; }

function formatValue(value: unknown): string { return value == null || value === '' ? '—' : typeof value === 'number' ? value.toFixed(1) : String(value); }

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`);
  return data as T;
}
