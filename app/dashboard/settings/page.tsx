'use client';

import { useEffect, useState, type ChangeEvent } from 'react';

interface SettingsData {
  [key: string]: string;
}

interface ContentPillar {
  slug: string;
  name: string;
  enabled: boolean;
  weight: number;
  locale: 'id' | 'en';
  source_policy: 'any' | 'github_repository';
  promo_eligible: boolean;
  position: number;
}

interface ContentComposition {
  slug: string;
  name: string;
  enabled: boolean;
  locale: 'id' | 'en';
  post_type: 'any' | 'education' | 'promotion';
  hook_rule: string;
  structure_rule: string;
  cta_rule: string;
  max_length: number;
  mode: 'standalone' | 'thread';
  hashtag_policy: string;
  source_link_policy: string;
  prompt_text: string;
  position: number;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData>({});
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [configStatus, setConfigStatus] = useState<string | null>(null);
  const [pillars, setPillars] = useState<ContentPillar[]>([]);
  const [compositions, setCompositions] = useState<ContentComposition[]>([]);
  const [newPillar, setNewPillar] = useState({ slug: '', name: '' });
  const [newComposition, setNewComposition] = useState({ slug: '', name: '' });

  const fetchSettings = async () => {
    const res = await fetch('/api/settings');
    const data = await res.json();
    setSettings(data.settings || {});
    setLoading(false);
  };

  const fetchPillars = async () => {
    const res = await fetch('/api/pillars');
    const data = await res.json();
    setPillars(data.pillars || []);
  };

  const fetchCompositions = async () => {
    const res = await fetch('/api/compositions');
    const data = await res.json();
    setCompositions(data.compositions || []);
  };

  const saveSetting = async (key: string, value: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      const data = await res.json();
      return res.ok ? null : (data.error || 'Gagal menyimpan setting');
    } catch {
      return 'Gagal menyimpan setting';
    }
  };

  const handleUpdate = async (key: string, value: string) => {
    const previous = settings[key];
    setError(null);
    setSettings(prev => ({ ...prev, [key]: value }));
    const saveError = await saveSetting(key, value);
    if (saveError) {
      setSettings(prev => ({ ...prev, [key]: previous }));
      setError(saveError);
    }
  };

  const updatePillar = async (pillar: ContentPillar, patch: Partial<ContentPillar>) => {
    setError(null);
    setPillars(current => current.map(item => item.slug === pillar.slug ? { ...item, ...patch } : item));
    const res = await fetch('/api/pillars', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: pillar.slug, ...patch }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Gagal menyimpan pillar');
      fetchPillars();
    }
  };

  const addPillar = async () => {
    const res = await fetch('/api/pillars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newPillar),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Gagal menambah pillar');
      return;
    }
    setNewPillar({ slug: '', name: '' });
    fetchPillars();
  };

  const updateComposition = async (composition: ContentComposition, patch: Partial<ContentComposition>) => {
    setError(null);
    setCompositions(current => current.map(item => item.slug === composition.slug ? { ...item, ...patch } : item));
    const res = await fetch('/api/compositions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: composition.slug, ...patch }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Gagal menyimpan composition');
      fetchCompositions();
    }
  };

  const addComposition = async () => {
    const res = await fetch('/api/compositions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newComposition),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Gagal menambah composition');
      return;
    }
    setNewComposition({ slug: '', name: '' });
    fetchCompositions();
  };

  const movePillar = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= pillars.length) return;
    const current = pillars[index];
    const next = pillars[target];
    updatePillar(current, { position: next.position });
    updatePillar(next, { position: current.position });
    setPillars(items => items.map(item => item.slug === current.slug
      ? { ...item, position: next.position }
      : item.slug === next.slug ? { ...item, position: current.position } : item
    ).sort((a, b) => a.position - b.position));
  };

  const exportConfig = async () => {
    setConfigStatus(null);
    const res = await fetch('/api/config');
    if (!res.ok) {
      setConfigStatus('Export gagal');
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'threads-auto-poster-config.json';
    link.click();
    window.URL.revokeObjectURL(url);
    setConfigStatus('Konfigurasi berhasil diekspor');
  };

  const importConfig = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setConfigStatus(null);
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await file.text(),
    });
    const data = await res.json();
    if (!res.ok) {
      setConfigStatus(data.error || 'Import gagal');
      return;
    }
    await fetchSettings();
    setConfigStatus(`Import berhasil: ${data.settings} settings, ${data.sources} source`);
  };

  const activeDays = settings.active_days ? JSON.parse(settings.active_days) : [1, 2, 3, 4, 5, 6, 0];

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch('/api/settings').then(res => res.json()),
      fetch('/api/pillars').then(res => res.json()),
      fetch('/api/compositions').then(res => res.json()),
    ]).then(([settingsData, pillarsData, compositionsData]) => {
      if (!active) return;
      setSettings(settingsData.settings || {});
      setPillars(pillarsData.pillars || []);
      setCompositions(compositionsData.compositions || []);
      setLoading(false);
    }).catch(() => { if (active) { setError('Gagal memuat settings'); setLoading(false); } });
    return () => { active = false; };
  }, []);

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      {error && <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="font-semibold text-lg mb-4">Posting Schedule</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Posts per day</label>
            <input
              type="number" min="1"
              value={settings.posts_per_day || '3'}
              onChange={(e) => handleUpdate('posts_per_day', e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Active hours start</label>
            <input
              type="number" min="0" max="23"
              value={settings.active_hours_start || '8'}
              onChange={(e) => handleUpdate('active_hours_start', e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Active hours end</label>
            <input
              type="number" min="0" max="23"
              value={settings.active_hours_end || '20'}
              onChange={(e) => handleUpdate('active_hours_end', e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Timezone</label>
            <input
              type="text"
              value={settings.timezone || 'Asia/Jakarta'}
              onChange={(e) => handleUpdate('timezone', e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium mb-2">Active days</label>
          <div className="flex gap-2">
            {[{n: 0, d: 'Sun'}, {n: 1, d: 'Mon'}, {n: 2, d: 'Tue'}, {n: 3, d: 'Wed'}, {n: 4, d: 'Thu'}, {n: 5, d: 'Fri'}, {n: 6, d: 'Sat'}].map((day) => (
              <button
                key={day.n}
                onClick={() => {
                  const days = [...activeDays];
                  if (days.includes(day.n)) {
                    days.splice(days.indexOf(day.n), 1);
                  } else {
                    days.push(day.n);
                  }
                  handleUpdate('active_days', JSON.stringify(days));
                }}
                className={`px-3 py-1 rounded text-sm ${
                  activeDays.includes(day.n)
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {day.d}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="font-semibold text-lg mb-4">Content Pillars</h2>
        <p className="mb-3 text-sm text-gray-600">Atur pillar aktif, bobot distribusi, urutan, kebijakan source, dan izin promo tanpa mengubah kode.</p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 mb-4">
          <input
            aria-label="Pillar slug baru"
            placeholder="slug-baru"
            value={newPillar.slug}
            onChange={(e) => setNewPillar({ ...newPillar, slug: e.target.value })}
            className="px-3 py-2 border rounded"
          />
          <input
            aria-label="Nama pillar baru"
            placeholder="Nama pillar baru"
            value={newPillar.name}
            onChange={(e) => setNewPillar({ ...newPillar, name: e.target.value })}
            className="px-3 py-2 border rounded"
          />
          <button type="button" onClick={addPillar} className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">Tambah</button>
        </div>
        <div className="space-y-3">
          {pillars.map((pillar, index) => (
            <div key={pillar.slug} className="grid grid-cols-1 md:grid-cols-[minmax(12rem,1fr)_5rem_5rem_6rem_10rem_auto] gap-2 items-center border-b pb-3">
              <div>
                <div className="font-medium">{pillar.name}</div>
                <div className="text-xs text-gray-500">{pillar.slug}</div>
              </div>
              <label className="text-xs">Bobot
                <input type="number" min="0" max="1000" value={pillar.weight} onChange={(e) => updatePillar(pillar, { weight: Number(e.target.value) })} className="w-full border rounded px-2 py-1" />
              </label>
              <label className="text-xs">Bahasa
                <select value={pillar.locale} onChange={(e) => updatePillar(pillar, { locale: e.target.value as ContentPillar['locale'] })} className="w-full border rounded px-2 py-1">
                  <option value="id">ID</option>
                  <option value="en">EN</option>
                </select>
              </label>
              <label className="text-xs">Source
                <select value={pillar.source_policy} onChange={(e) => updatePillar(pillar, { source_policy: e.target.value as ContentPillar['source_policy'] })} className="w-full border rounded px-2 py-1">
                  <option value="any">Any HTTPS</option>
                  <option value="github_repository">GitHub repo</option>
                </select>
              </label>
              <div className="flex flex-wrap gap-2 text-xs">
                <label><input type="checkbox" checked={pillar.enabled} onChange={(e) => updatePillar(pillar, { enabled: e.target.checked })} /> Aktif</label>
                <label><input type="checkbox" checked={pillar.promo_eligible} onChange={(e) => updatePillar(pillar, { promo_eligible: e.target.checked })} /> Promo</label>
              </div>
              <div className="flex gap-1 justify-end">
                <button type="button" aria-label={`Naikkan ${pillar.name}`} disabled={index === 0} onClick={() => movePillar(index, -1)} className="px-2 py-1 border rounded disabled:opacity-40">↑</button>
                <button type="button" aria-label={`Turunkan ${pillar.name}`} disabled={index === pillars.length - 1} onClick={() => movePillar(index, 1)} className="px-2 py-1 border rounded disabled:opacity-40">↓</button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <label className="block text-sm font-medium mb-1">Promo ratio (max 20%)</label>
          <input
            type="range" min="0" max="20"
            value={parseFloat(settings.promo_ratio || '0.2') * 100}
            onChange={(e) => handleUpdate('promo_ratio', (parseInt(e.target.value) / 100).toString())}
            className="w-full"
          />
          <span className="text-sm text-gray-500">{settings.promo_ratio || '0.2'}</span>
        </div>
      </div>

      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="font-semibold text-lg mb-4">Content Compositions</h2>
        <p className="mb-3 text-sm text-gray-600">Setiap composition mengatur hook, struktur, CTA, panjang, mode standalone/thread, hashtag, dan source-link.</p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 mb-4">
          <input aria-label="Composition slug baru" placeholder="composition-baru" value={newComposition.slug} onChange={(e) => setNewComposition({ ...newComposition, slug: e.target.value })} className="px-3 py-2 border rounded" />
          <input aria-label="Nama composition baru" placeholder="Nama composition baru" value={newComposition.name} onChange={(e) => setNewComposition({ ...newComposition, name: e.target.value })} className="px-3 py-2 border rounded" />
          <button type="button" onClick={addComposition} className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">Tambah</button>
        </div>
        <div className="space-y-3">
          {compositions.map((composition) => (
            <details key={composition.slug} className="border rounded p-3">
              <summary className="cursor-pointer font-medium">{composition.name} <span className="text-xs text-gray-500">({composition.slug})</span></summary>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
                <label className="text-xs">Nama<input value={composition.name} onChange={(e) => updateComposition(composition, { name: e.target.value })} className="w-full border rounded px-2 py-1" /></label>
                <label className="text-xs">Bahasa<select value={composition.locale} onChange={(e) => updateComposition(composition, { locale: e.target.value as ContentComposition['locale'] })} className="w-full border rounded px-2 py-1"><option value="id">ID</option><option value="en">EN</option></select></label>
                <label className="text-xs">Tipe<select value={composition.post_type} onChange={(e) => updateComposition(composition, { post_type: e.target.value as ContentComposition['post_type'] })} className="w-full border rounded px-2 py-1"><option value="any">Any</option><option value="education">Education</option><option value="promotion">Promotion</option></select></label>
                <label className="text-xs">Panjang<input type="number" min="1" max="500" value={composition.max_length} onChange={(e) => updateComposition(composition, { max_length: Number(e.target.value) })} className="w-full border rounded px-2 py-1" /></label>
                <label className="text-xs">Mode<select value={composition.mode} onChange={(e) => updateComposition(composition, { mode: e.target.value as ContentComposition['mode'] })} className="w-full border rounded px-2 py-1"><option value="standalone">Standalone</option><option value="thread">Thread</option></select></label>
                <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={composition.enabled} onChange={(e) => updateComposition(composition, { enabled: e.target.checked })} /> Aktif</label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                {(['hook_rule', 'structure_rule', 'cta_rule', 'hashtag_policy', 'source_link_policy', 'prompt_text'] as const).map((field) => (
                  <label key={field} className="text-xs">{field.replaceAll('_', ' ')}<textarea value={composition[field]} onChange={(e) => updateComposition(composition, { [field]: e.target.value })} rows={2} className="w-full border rounded px-2 py-1" /></label>
                ))}
              </div>
            </details>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="font-semibold text-lg mb-4">Configuration portability</h2>
        <p className="text-sm text-gray-600 mb-3">Export settings dan source tanpa token, password hash, history, atau database runtime.</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportConfig}
            className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
          >
            Export JSON
          </button>
          <label className="px-3 py-2 rounded border cursor-pointer hover:bg-gray-50">
            Import JSON
            <input type="file" accept="application/json,.json" onChange={importConfig} className="sr-only" />
          </label>
        </div>
        {configStatus && <p role="status" className="mt-3 text-sm text-gray-600">{configStatus}</p>}
      </div>

      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="font-semibold text-lg mb-4">System</h2>

        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm">UI language<select value={settings.ui_locale || 'id'} onChange={(e) => handleUpdate('ui_locale', e.target.value)} className="mt-1 w-full border rounded px-2 py-1"><option value="id">Bahasa Indonesia</option><option value="en">English</option></select></label>
            <label className="text-sm">Content language<select value={settings.content_locale || 'id'} onChange={(e) => handleUpdate('content_locale', e.target.value)} className="mt-1 w-full border rounded px-2 py-1"><option value="id">Bahasa Indonesia</option><option value="en">English</option></select></label>
            <label className="text-sm">GitHub URL<input value={settings.github_url || ''} onChange={(e) => handleUpdate('github_url', e.target.value)} placeholder="https://github.com/..." className="mt-1 w-full border rounded px-2 py-1" /></label>
            <label className="text-sm">Website / Yanstd URL<input value={settings.website_url || ''} onChange={(e) => handleUpdate('website_url', e.target.value)} placeholder="https://..." className="mt-1 w-full border rounded px-2 py-1" /></label>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">Posting mode</span>
            <select
              value={settings.posting_mode || 'approval'}
              onChange={(e) => handleUpdate('posting_mode', e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="approval">Draft (approval required)</option>
              <option value="auto">Auto-post</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm">Kill switch</span>
            <button
              onClick={async () => {
                const res = await fetch('/api/settings?action=scheduler_toggle');
                const data = await res.json();
                setSettings(prev => ({ ...prev, kill_switch: data.kill_switch }));
              }}
              className={`px-3 py-1 rounded text-sm ${
                settings.kill_switch === 'true'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-green-100 text-green-700'
              }`}
            >
              {settings.kill_switch === 'true' ? 'ON — Disable' : 'OFF — Enable'}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm">Hermes model</span>
            <input
              type="text"
              value={settings.hermes_model || 'THREADS'}
              onChange={(e) => handleUpdate('hermes_model', e.target.value)}
              className="border rounded px-2 py-1 text-sm w-48"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm">Hermes profile</span>
            <input
              type="text"
              value={settings.hermes_profile || 'default'}
              onChange={(e) => handleUpdate('hermes_profile', e.target.value)}
              className="border rounded px-2 py-1 text-sm w-32"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
