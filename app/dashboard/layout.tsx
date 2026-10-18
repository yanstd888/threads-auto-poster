'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Calendar, FileText, Settings, Shield, BarChart3, LogOut, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { I18nProvider, useI18n, type AppLocale } from '@/lib/i18n';
import { OFFICIAL_GITHUB_URL, OFFICIAL_STORE_URL, OFFICIAL_WEBSITE_URL } from '@/lib/brand-links';
import { APP_VERSION_LABEL } from '@/lib/app-version';

const menuItems = [
  { icon: LayoutDashboard, key: 'dashboard', href: '/dashboard' },
  { icon: Calendar, key: 'schedule', href: '/dashboard/schedule' },
  { icon: FileText, key: 'content', href: '/dashboard/posts' },
  { icon: BarChart3, key: 'analytics', href: '/dashboard/analytics' },
  { icon: Shield, key: 'credentials', href: '/dashboard/credentials' },
  { icon: ExternalLink, key: 'sources', href: '/dashboard/sources' },
  { icon: Settings, key: 'settings', href: '/dashboard/settings' },
] as const;

type SettingsState = { kill_switch?: string; ui_locale?: string };
type UpdateState = { latestVersion?: string | null; updateAvailable?: boolean; releaseUrl?: string };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>('id');
  const [settings, setSettings] = useState<SettingsState>({});
  const [update, setUpdate] = useState<UpdateState>({});

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(data => {
      const next = data.settings || {};
      setSettings(next);
      if (next.ui_locale === 'en') setLocale('en');
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch('/api/update').then(response => response.ok ? response.json() : null).then(data => {
      if (data) setUpdate(data);
    }).catch(() => undefined);
  }, []);

  const changeLocale = async (next: AppLocale) => {
    setLocale(next);
    setSettings(current => ({ ...current, ui_locale: next }));
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'ui_locale', value: next }) });
  };

  return <I18nProvider locale={locale} onLocaleChange={changeLocale}><DashboardShell settings={settings} update={update}>{children}</DashboardShell></I18nProvider>;
}

function DashboardShell({ children, settings, update }: { children: React.ReactNode; settings: SettingsState; update: UpdateState }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, locale, setLocale } = useI18n();
  const [killSwitchOverride, setKillSwitchOverride] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const killSwitch = killSwitchOverride ?? settings.kill_switch === 'true';

  const toggleKillSwitch = async () => {
    setLoading(true);
    const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'scheduler_toggle' }) });
    const data = await res.json();
    setKillSwitchOverride(data.kill_switch === true || data.kill_switch === 'true');
    setLoading(false);
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const label = (key: (typeof menuItems)[number]['key']) => key === 'dashboard' ? t.dashboard : key === 'schedule' ? t.schedule : key === 'content' ? t.content : key === 'sources' ? t.sources : key === 'settings' ? t.settings : key === 'analytics' ? (locale === 'en' ? 'Analytics' : 'Analitik') : (locale === 'en' ? 'Credentials' : 'Kredensial');

  return (
    <div className="brutal-app flex min-h-[100dvh] overflow-hidden">
      <aside className="brutal-sidebar flex shrink-0 flex-col">
        <div className="border-b-[3px] border-black p-5">
          <Link href="/dashboard" className="brutal-brand">
            <span className="brutal-brand__name">{t.appName}</span>
            <span className="brutal-brand__tag">CONTENT CONTROL</span>
          </Link>
        </div>
        <nav className="flex-1 p-3" aria-label="Dashboard">
          {menuItems.map((item) => {
            const isActive = pathname === item.href;
            return <Link key={item.href} href={item.href} className={`brutal-nav-link flex items-center gap-3 px-3 py-2 text-sm ${isActive ? 'brutal-nav-link--active' : ''}`}><item.icon className="h-4 w-4" strokeWidth={2.5} />{label(item.key)}</Link>;
          })}
          <div className="brutal-brand-links" aria-label="Official links">
            <a href={OFFICIAL_GITHUB_URL} target="_blank" rel="noopener noreferrer"><Image src="/brand/github.svg" alt="GitHub" width={16} height={16} />YANSTD888</a>
            <a href={OFFICIAL_STORE_URL} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" aria-hidden="true" />TOKOYANS</a>
            <a href={OFFICIAL_WEBSITE_URL} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" aria-hidden="true" />YANSTD888</a>
          </div>
        </nav>
        <div className="border-t-[3px] border-black p-4">
          {update.updateAvailable && update.latestVersion && update.releaseUrl ? (
            <a href={update.releaseUrl} target="_blank" rel="noopener noreferrer" className="mb-3 block border-2 border-black bg-yellow-200 px-3 py-2 text-xs font-bold text-black">
              Update tersedia: v{update.latestVersion} → buka release
            </a>
          ) : null}
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide">{t.language}</label>
          <select value={locale} onChange={event => void setLocale(event.target.value as AppLocale)} className="mb-3 w-full px-2 py-2 text-sm"><option value="id">Bahasa Indonesia</option><option value="en">English</option></select>

          <button onClick={toggleKillSwitch} disabled={loading} className={`mb-2 flex w-full items-center justify-center gap-2 px-3 py-2 text-sm ${killSwitch ? 'bg-gray-100 text-gray-800' : 'bg-green-100 text-green-800'}`}>{killSwitch ? `${t.killSwitch}: ON` : `${t.killSwitch}: OFF`}</button>
          <button onClick={logout} className="flex w-full items-center justify-center gap-2 bg-pink-300 px-3 py-2 text-sm text-black"><LogOut className="h-4 w-4" strokeWidth={2.5} />{t.logout}</button>
          <p className="mt-3 text-center text-[11px] font-bold uppercase tracking-wide text-gray-500">Version {APP_VERSION_LABEL}</p>
        </div>
      </aside>
      <main className="brutal-main flex-1 overflow-auto">{children}</main>
    </div>
  );
}