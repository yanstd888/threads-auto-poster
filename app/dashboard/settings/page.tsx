'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { ExternalLink, Globe2 } from 'lucide-react';
import Image from 'next/image';
import { useI18n } from '@/lib/i18n';
import { translateUi } from '@/lib/ui-translations';

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
  const { locale } = useI18n();
  const ui = (key: string, vars?: Record<string, string | number>) => translateUi(locale, key, vars);
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
      return res.ok ? null : (data.error || (locale === 'en' ? 'Failed to save setting' : 'Gagal menyimpan setting'));
    } catch {
      return locale === 'en' ? 'Failed to save setting' : 'Gagal menyimpan setting';
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
      setError(data.error || (locale === 'en' ? 'Failed to save pillar' : 'Gagal menyimpan pillar'));
      fetchPillars();
    } else fetchPillars();
  };

  const addPillar = async () => {
    const res = await fetch('/api/pillars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newPillar),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || (locale === 'en' ? 'Failed to add pillar' : 'Gagal menambah pillar'));
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
      setError(data.error || (locale === 'en' ? 'Failed to save composition' : 'Gagal menyimpan composition'));
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
      setError(data.error || (locale === 'en' ? 'Failed to add composition' : 'Gagal menambah composition'));
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
      setConfigStatus(ui('Export failed'));
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'threads-auto-poster-config.json';
    link.click();
    window.URL.revokeObjectURL(url);
    setConfigStatus(ui('Configuration exported successfully'));
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
      setConfigStatus(data.error || ui('Import failed'));
      return;
    }
    await fetchSettings();
    setConfigStatus(`${ui('Import succeeded')}: ${data.settings} settings, ${data.sources} ${locale === 'en' ? 'sources' : 'source'}`);
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
    }).catch(() => { if (active) { setError(locale === 'en' ? 'Failed to load settings' : 'Gagal memuat settings'); setLoading(false); } });
    return () => { active = false; };
  }, [locale]);

  if (loading) return <div className="p-6">{ui('Loading...')}</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">{ui('Settings')}</h1>

      <section className="bg-white rounded-lg border p-6 mb-6" aria-labelledby="official-links-heading">
        <h2 id="official-links-heading" className="font-semibold text-lg mb-4">{locale === 'en' ? 'Official links' : 'Link resmi'}</h2>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://github.com/yanstd888"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-gray-900 hover:bg-yellow-100"
          >
            <Image src="/brand/github.svg" alt="GitHub" width={20} height={20} />
            <span>GitHub · YANSTD888</span>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
          <a
            href="https://lynk.id/tokoyans"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-gray-900 hover:bg-yellow-100"
          >
            <Globe2 className="h-5 w-5" aria-hidden="true" />
            <span>Website · TOKOYANS</span>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
          <a
            href="https://yanstd.web.id"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-gray-900 hover:bg-yellow-100"
          >
            <Globe2 className="h-5 w-5" aria-hidden="true" />
            <span>Website · YANSTD888</span>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </section>

      {error && <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="font-semibold text-lg mb-4">{ui('Posting Schedule')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">{ui('Posts per day')}</label>
            <input
              type="number" min="1"
              value={settings.posts_per_day || '3'}
              onChange={(e) => handleUpdate('posts_per_day', e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{ui('Active hours start')}</label>
            <input
              type="number" min="0" max="23"
              value={settings.active_hours_start || '8'}
              onChange={(e) => handleUpdate('active_hours_start', e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{ui('Active hours end')}</label>
            <input
              type="number" min="0" max="23"
              value={settings.active_hours_end || '20'}
              onChange={(e) => handleUpdate('active_hours_end', e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{ui('Timezone')}</label>
            <input
              type="text"
              value={settings.timezone || 'UTC'}
              onChange={(e) => handleUpdate('timezone', e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium mb-2">{ui('Active days')}</label>
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
        <h2 className="font-semibold text-lg mb-4">{ui('Content Pillars')}</h2>
        <p className="mb-3 text-sm text-gray-600">{ui('Atur pillar aktif, bobot distribusi, urutan, kebijakan source, dan izin promo tanpa mengubah kode.')}</p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 mb-4">
          <input
            aria-label={locale === 'en' ? 'New pillar slug' : 'Slug pillar baru'}
            placeholder={locale === 'en' ? 'new-slug' : 'slug-baru'}
            value={newPillar.slug}
            onChange={(e) => setNewPillar({ ...newPillar, slug: e.target.value })}
            className="px-3 py-2 border rounded"
          />
          <input
            aria-label={locale === 'en' ? 'New pillar name' : 'Nama pillar baru'}
            placeholder={locale === 'en' ? 'New pillar name' : 'Nama pillar baru'}
            value={newPillar.name}
            onChange={(e) => setNewPillar({ ...newPillar, name: e.target.value })}
            className="px-3 py-2 border rounded"
          />
          <button type="button" onClick={addPillar} className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">{ui('Add')}</button>
        </div>
        <div className="space-y-3">
          {pillars.map((pillar, index) => (
            <div key={pillar.slug} className="grid grid-cols-1 md:grid-cols-[minmax(12rem,1fr)_5rem_5rem_6rem_10rem_auto] gap-2 items-center border-b pb-3">
              <div>
                <div className="font-medium">{pillar.name}</div>
                <div className="text-xs text-gray-500">{pillar.slug}</div>
              </div>
              <label className="text-xs">{ui('Weight')}
                <input type="number" min="0" max="100" value={pillar.weight} onChange={(e) => updatePillar(pillar, { weight: Number(e.target.value) })} className="w-full border rounded px-2 py-1" />
              </label>
              <label className="text-xs">{ui('Language')}
                <select value={pillar.locale} onChange={(e) => updatePillar(pillar, { locale: e.target.value as ContentPillar['locale'] })} className="w-full border rounded px-2 py-1">
                  <option value="id">ID</option>
                  <option value="en">EN</option>
                </select>
              </label>
              <label className="text-xs">{ui('Source')}
                <select value={pillar.source_policy} onChange={(e) => updatePillar(pillar, { source_policy: e.target.value as ContentPillar['source_policy'] })} className="w-full border rounded px-2 py-1">
                  <option value="any">Any HTTPS</option>
                  <option value="github_repository">GitHub repo</option>
                </select>
              </label>
              <div className="flex flex-wrap gap-2 text-xs">
                <label><input type="checkbox" checked={pillar.enabled} onChange={(e) => updatePillar(pillar, { enabled: e.target.checked })} /> {ui('Active')}</label>
                <label><input type="checkbox" checked={pillar.promo_eligible} onChange={(e) => updatePillar(pillar, { promo_eligible: e.target.checked })} /> {ui('Promo')}</label>
              </div>
              <div className="flex gap-1 justify-end">
                <button type="button" aria-label={`Naikkan ${pillar.name}`} disabled={index === 0} onClick={() => movePillar(index, -1)} className="px-2 py-1 border rounded disabled:opacity-40">↑</button>
                <button type="button" aria-label={`Turunkan ${pillar.name}`} disabled={index === pillars.length - 1} onClick={() => movePillar(index, 1)} className="px-2 py-1 border rounded disabled:opacity-40">↓</button>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-3 text-xs text-gray-500">{locale === 'en' ? 'Active pillar weights are automatically normalized to 100% after every add or edit.' : 'Bobot pillar aktif otomatis dinormalisasi menjadi total 100% setelah tambah atau edit.'}</p>

        <div className="mt-5">
          <label className="block text-sm font-medium mb-1">{locale === 'en' ? 'Promo ratio (max 20%)' : 'Rasio promo (maks. 20%)'}</label>
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
        <h2 className="font-semibold text-lg mb-4">{ui('Content Compositions')}</h2>
        <p className="mb-3 text-sm text-gray-600">{ui('Setiap composition mengatur hook, struktur, CTA, panjang, mode standalone/thread, hashtag, dan source-link.')}</p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 mb-4">
          <input aria-label={locale === 'en' ? 'New composition slug' : 'Slug composition baru'} placeholder={locale === 'en' ? 'new-composition' : 'composition-baru'} value={newComposition.slug} onChange={(e) => setNewComposition({ ...newComposition, slug: e.target.value })} className="px-3 py-2 border rounded" />
          <input aria-label={locale === 'en' ? 'New composition name' : 'Nama composition baru'} placeholder={locale === 'en' ? 'New composition name' : 'Nama composition baru'} value={newComposition.name} onChange={(e) => setNewComposition({ ...newComposition, name: e.target.value })} className="px-3 py-2 border rounded" />
          <button type="button" onClick={addComposition} className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">{ui('Add')}</button>
        </div>
        <div className="space-y-3">
          {compositions.map((composition) => (
            <details key={composition.slug} className="border rounded p-3">
              <summary className="cursor-pointer font-medium">{composition.name} <span className="text-xs text-gray-500">({composition.slug})</span></summary>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
                <label className="text-xs">{ui('Name')}<input value={composition.name} onChange={(e) => updateComposition(composition, { name: e.target.value })} className="w-full border rounded px-2 py-1" /></label>
                <label className="text-xs">{ui('Language')}<select value={composition.locale} onChange={(e) => updateComposition(composition, { locale: e.target.value as ContentComposition['locale'] })} className="w-full border rounded px-2 py-1"><option value="id">ID</option><option value="en">EN</option></select></label>
                <label className="text-xs">{ui('Type')}<select value={composition.post_type} onChange={(e) => updateComposition(composition, { post_type: e.target.value as ContentComposition['post_type'] })} className="w-full border rounded px-2 py-1"><option value="any">Any</option><option value="education">Education</option><option value="promotion">Promotion</option></select></label>
                <label className="text-xs">{ui('Length')}<input type="number" min="1" max="500" value={composition.max_length} onChange={(e) => updateComposition(composition, { max_length: Number(e.target.value) })} className="w-full border rounded px-2 py-1" /></label>
                <label className="text-xs">{ui('Mode')}<select value={composition.mode} onChange={(e) => updateComposition(composition, { mode: e.target.value as ContentComposition['mode'] })} className="w-full border rounded px-2 py-1"><option value="standalone">Standalone</option><option value="thread">Thread</option></select></label>
                <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={composition.enabled} onChange={(e) => updateComposition(composition, { enabled: e.target.checked })} /> {ui('Active')}</label>
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
        <h2 className="font-semibold text-lg mb-4">{ui('Configuration portability')}</h2>
        <p className="text-sm text-gray-600 mb-3">{ui('Export settings dan source tanpa token, password hash, history, atau database runtime.')}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportConfig}
            className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
          >
            {ui('Export JSON')}
          </button>
          <label className="px-3 py-2 rounded border cursor-pointer hover:bg-gray-50">
            {ui('Import JSON')}
            <input type="file" accept="application/json,.json" onChange={importConfig} className="sr-only" />
          </label>
        </div>
        {configStatus && <p role="status" className="mt-3 text-sm text-gray-600">{configStatus}</p>}
      </div>

      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="font-semibold text-lg mb-4">{ui('System')}</h2>

        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm">{ui('UI language')}<select value={settings.ui_locale || 'id'} onChange={(e) => handleUpdate('ui_locale', e.target.value)} className="mt-1 w-full border rounded px-2 py-1"><option value="id">{ui('Bahasa Indonesia')}</option><option value="en">{ui('English')}</option></select></label>
            <label className="text-sm">{ui('Content language')}<select value={settings.content_locale || 'id'} onChange={(e) => handleUpdate('content_locale', e.target.value)} className="mt-1 w-full border rounded px-2 py-1"><option value="id">{ui('Bahasa Indonesia')}</option><option value="en">{ui('English')}</option></select></label>

          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">{ui('Posting mode')}</span>
            <select
              value={settings.posting_mode || 'approval'}
              onChange={(e) => handleUpdate('posting_mode', e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="approval">{ui('Draft (approval required)')}</option>
              <option value="auto">{ui('Auto-post')}</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm">{ui('Kill Switch')}</span>
            <button
              onClick={async () => {
                const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'scheduler_toggle' }) });
                const data = await res.json();
                setSettings(prev => ({ ...prev, kill_switch: data.kill_switch }));
              }}
              className={`px-3 py-1 rounded text-sm ${
                settings.kill_switch === 'true'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-green-100 text-green-700'
              }`}
            >
              {settings.kill_switch === 'true' ? `${ui('Kill Switch ON')} — ${locale === 'en' ? 'Disable' : 'Matikan'}` : `${ui('Kill Switch OFF')} — ${locale === 'en' ? 'Enable' : 'Nyalakan'}`}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm">{ui('Hermes model')}</span>
            <input
              type="text"
              value={settings.hermes_model || 'default'}
              onChange={(e) => handleUpdate('hermes_model', e.target.value)}
              className="border rounded px-2 py-1 text-sm w-48"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm">{ui('Hermes profile')}</span>
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
