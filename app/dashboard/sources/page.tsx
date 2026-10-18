'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { Globe, CheckCircle, AlertCircle, RefreshCw, Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { translateUi } from '@/lib/ui-translations';

interface Source {
  id: number; name: string; url: string; pillar: string; source_type: string;
  last_checked: number | null; approved: number; created_at: number;
  health_status: string | null; health_http_status: number | null; health_error: string | null;
}

interface PillarOption { slug: string; name: string }

export default function SourcesPage() {
  const { locale } = useI18n();
  const ui = (key: string, vars?: Record<string, string | number>) => translateUi(locale, key, vars);
  const healthLabel = (value: string | null) => ({ unknown: ui('Unknown'), live: ui('Live'), redirect: ui('Redirect'), transient: ui('Transient'), dead: ui('Dead') }[value || 'unknown'] || value || ui('Unknown'));
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [pillars, setPillars] = useState<PillarOption[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSource, setNewSource] = useState({ name: '', url: '', pillar: 'github', source_type: 'manual' });
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');

  const fetchSources = async (nextPage = 1, search = query, health = status) => {
    const params = new URLSearchParams({ page: String(nextPage), page_size: '25' });
    if (search) params.set('q', search);
    if (health) params.set('status', health);
    const res = await fetch(`/api/sources?${params}`);
    const data = await res.json();
    setSources(data.sources || []);
    setPage(data.pagination?.page || nextPage);
    setPages(data.pagination?.pages || 1);
    setTotal(data.pagination?.total || 0);
    setLoading(false);
  };


  const handleAdd = async () => {
    if (!newSource.name || !newSource.url || !newSource.pillar) { alert(ui('Please fill all fields')); return; }
    const res = await fetch('/api/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSource) });
    if (!res.ok) { const data = await res.json(); alert(data.error || ui('Failed to add source')); return; }
    setNewSource({ name: '', url: '', pillar: pillars[0]?.slug || 'github', source_type: 'manual' });
    setShowAddForm(false);
    fetchSources(1);
  };

  const handleCheck = async (id: number, url: string) => {
    const res = await fetch('/api/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check', id }) });
    if (!res.ok) { const data = await res.json(); alert(data.error || ui('Health check failed')); return; }
    fetchSources(page);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(locale === 'en' ? 'Delete this source?' : 'Hapus source ini?')) return;
    const res = await fetch(`/api/sources?id=${id}`, { method: 'DELETE' });
    if (!res.ok) { const data = await res.json(); alert(data.error || ui('Delete failed')); return; }
    fetchSources(page);
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const sources = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && 'sources' in parsed && Array.isArray(parsed.sources) ? parsed.sources : null;
      if (!sources) { alert(ui('Import format is invalid')); return; }
      const dryRun = await fetch('/api/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import', sources, dry_run: true }) });
      const report = await dryRun.json();
      if (!dryRun.ok || report.errors?.length) { alert(`${locale === 'en' ? 'Import rejected' : 'Import ditolak'}: ${report.errors?.[0]?.error || report.error || (locale === 'en' ? 'invalid format' : 'format tidak valid')}`); return; }
      if (!window.confirm(locale === 'en' ? `${report.valid} valid sources. Import now?` : `${report.valid} source valid. Import sekarang?`)) return;
      const result = await fetch('/api/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import', sources }) });
      const data = await result.json();
      if (!result.ok) { alert(data.error || ui('Import failed')); return; }
      alert(locale === 'en' ? `${data.imported} sources imported` : `${data.imported} source diimpor`);
      fetchSources(1);
    } catch { alert(ui('File JSON is invalid')); }
  };

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch('/api/sources?page=1&page_size=25').then(res => res.json()),
      fetch('/api/pillars').then(res => res.json()),
    ]).then(([sourcesData, pillarsData]) => {
      if (!active) return;
      setSources(sourcesData.sources || []);
      setPage(sourcesData.pagination?.page || 1);
      setPages(sourcesData.pagination?.pages || 1);
      setTotal(sourcesData.pagination?.total || 0);
      setPillars((pillarsData.pillars || []).filter((pillar: { enabled: boolean }) => pillar.enabled));
      setLoading(false);
    }).catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading) return <div className="p-6">{ui('Loading...')}</div>;

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">{ui('Source Registry')}</h1><div className="flex gap-2"><a href="/api/sources?export=1&format=json" className="px-3 py-2 border rounded">{ui('Export JSON')}</a><a href="/api/sources?export=1&format=csv" className="px-3 py-2 border rounded">{ui('Export CSV')}</a><label className="px-3 py-2 border rounded cursor-pointer">{ui('Import JSON')}<input type="file" accept="application/json,.json" onChange={handleImport} className="hidden" /></label><button onClick={() => setShowAddForm(!showAddForm)} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">+ {ui('Add Source')}</button></div></div>
      <div className="flex flex-wrap gap-2 mb-4"><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') fetchSources(1, e.currentTarget.value, status); }} placeholder={ui('Search name or URL')} className="px-3 py-2 border rounded" /><select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2 border rounded"><option value="">{ui('All health')}</option><option value="unknown">Unknown</option><option value="live">Live</option><option value="redirect">Redirect</option><option value="transient">Transient</option><option value="dead">Dead</option></select><button onClick={() => fetchSources(1)} className="px-3 py-2 border rounded">{ui('Filter')}</button><span className="self-center text-sm text-gray-500">{total} {locale === 'en' ? 'sources' : 'source'}</span></div>

      {showAddForm && <div className="bg-white border rounded-lg p-4 mb-6"><h3 className="font-medium mb-3">{ui('Add New Source')}</h3><div className="grid grid-cols-2 gap-3"><input type="text" placeholder={ui('Name')} value={newSource.name} onChange={(e) => setNewSource({ ...newSource, name: e.target.value })} className="px-3 py-2 border rounded" /><input type="url" placeholder={ui('URL')} value={newSource.url} onChange={(e) => setNewSource({ ...newSource, url: e.target.value })} className="px-3 py-2 border rounded" /><select value={newSource.pillar} onChange={(e) => setNewSource({ ...newSource, pillar: e.target.value })} className="px-3 py-2 border rounded">{pillars.map((pillar) => <option key={pillar.slug} value={pillar.slug}>{pillar.name}</option>)}</select><select value={newSource.source_type} onChange={(e) => setNewSource({ ...newSource, source_type: e.target.value })} className="px-3 py-2 border rounded"><option value="manual">{ui('Manual')}</option><option value="api">{ui('API')}</option><option value="webpage">{ui('Webpage')}</option></select></div><div className="flex gap-2 mt-3"><button onClick={handleAdd} className="px-3 py-1 bg-green-600 text-white rounded">{ui('Add')}</button><button onClick={() => setShowAddForm(false)} className="px-3 py-1 text-gray-600 border rounded">{ui('Cancel')}</button></div></div>}

      <div className="bg-white rounded-lg border overflow-hidden"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50"><tr><th className="text-left px-4 py-2 text-sm font-medium">{ui('Name')}</th><th className="text-left px-4 py-2 text-sm font-medium">{ui('URL')}</th><th className="text-left px-4 py-2 text-sm font-medium">{ui('Pillar')}</th><th className="text-left px-4 py-2 text-sm font-medium">{ui('Type')}</th><th className="text-left px-4 py-2 text-sm font-medium">{ui('Approved')}</th><th className="text-left px-4 py-2 text-sm font-medium">{ui('Health')}</th><th className="text-left px-4 py-2 text-sm font-medium">{ui('Last Checked')}</th><th className="px-4 py-2" /></tr></thead><tbody>{sources.length === 0 ? <tr><td colSpan={8} className="text-center py-4 text-gray-500">{ui('No sources yet')}</td></tr> : sources.map((source) => <tr key={source.id} className="border-b"><td className="px-4 py-2"><div className="flex items-center gap-2"><Globe className="w-4 h-4 text-gray-400" /><span className="text-sm">{source.name}</span></div></td><td className="px-4 py-2"><a href={source.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 truncate max-w-xs block">{source.url}</a></td><td className="px-4 py-2 text-sm">{pillars.find(pillar => pillar.slug === source.pillar)?.name || source.pillar}</td><td className="px-4 py-2 text-sm text-gray-500">{source.source_type}</td><td className="px-4 py-2">{source.approved ? <CheckCircle className="w-5 h-5 text-green-500" /> : <AlertCircle className="w-5 h-5 text-yellow-500" />}</td><td className="px-4 py-2 text-sm"><span className={source.health_status === 'live' ? 'text-green-600' : source.health_status === 'dead' ? 'text-red-600' : 'text-yellow-600'}>{healthLabel(source.health_status)}{source.health_http_status ? ` (${source.health_http_status})` : ''}</span></td><td className="px-4 py-2 text-sm text-gray-500">{source.last_checked ? new Date(source.last_checked).toLocaleString(locale === 'en' ? 'en-US' : 'id-ID') : ui('Never')}</td><td className="px-4 py-2"><div className="flex gap-2"><button onClick={() => handleCheck(source.id, source.url)} className="text-blue-600 hover:text-blue-800" title={locale === 'en' ? 'Check URL' : 'Cek URL'}><RefreshCw className="w-4 h-4" /></button><button onClick={() => handleDelete(source.id)} className="text-red-600 hover:text-red-800" title={ui('Delete')}><Trash2 className="w-4 h-4" /></button></div></td></tr>)}</tbody></table></div></div>
      <div className="flex items-center justify-between mt-4"><button disabled={page <= 1} onClick={() => fetchSources(page - 1)} className="px-3 py-1 border rounded disabled:opacity-40">{ui('Previous')}</button><span className="text-sm text-gray-500">{ui('Page {page} of {total}', { page, total: pages })}</span><button disabled={page >= pages} onClick={() => fetchSources(page + 1)} className="px-3 py-1 border rounded disabled:opacity-40">{ui('Next')}</button></div>
    </div>
  );
}