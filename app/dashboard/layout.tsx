'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Calendar, FileText, Settings, Shield, BarChart3, LogOut, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { I18nProvider, useI18n, type AppLocale } from '@/lib/i18n';

const menuItems = [
  { icon: LayoutDashboard, key: 'dashboard', href: '/dashboard' },
  { icon: Calendar, key: 'schedule', href: '/dashboard/schedule' },
  { icon: FileText, key: 'content', href: '/dashboard/posts' },
  { icon: BarChart3, key: 'analytics', href: '/dashboard/analytics' },
  { icon: Shield, key: 'credentials', href: '/dashboard/credentials' },
  { icon: ExternalLink, key: 'sources', href: '/dashboard/sources' },
  { icon: Settings, key: 'settings', href: '/dashboard/settings' },
] as const;

type SettingsState = { kill_switch?: string; ui_locale?: string; github_url?: string; website_url?: string };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>('id');
  const [settings, setSettings] = useState<SettingsState>({});

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(data => {
      const next = data.settings || {};
      setSettings(next);
      if (next.ui_locale === 'en') setLocale('en');
    }).catch(() => undefined);
  }, []);

  const changeLocale = async (next: AppLocale) => {
    setLocale(next);
    setSettings(current => ({ ...current, ui_locale: next }));
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ui_locale: next }) });
  };

  return <I18nProvider locale={locale} onLocaleChange={changeLocale}><DashboardShell settings={settings}>{children}</DashboardShell></I18nProvider>;
}

function DashboardShell({ children, settings }: { children: React.ReactNode; settings: SettingsState }) {
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
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <div className="w-64 bg-white border-r flex flex-col">
        <div className="p-4 border-b"><h2 className="font-bold text-lg">{t.appName}</h2><p className="text-xs text-gray-500">v1.0.0</p></div>
        <nav className="flex-1 p-2">
          {menuItems.map((item) => {
            const isActive = pathname === item.href;
            return <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'}`}><item.icon className="w-4 h-4" />{label(item.key)}</Link>;
          })}
        </nav>
        <div className="p-4 border-t">
          <label className="block text-xs text-gray-500 mb-1">{t.language}</label>
          <select value={locale} onChange={event => void setLocale(event.target.value as AppLocale)} className="w-full mb-2 rounded-md border px-2 py-1 text-sm"><option value="id">Bahasa Indonesia</option><option value="en">English</option></select>
          <div className="flex gap-2 mb-2 text-xs">{settings.github_url ? <a className="text-blue-600 hover:underline" href={settings.github_url} target="_blank" rel="noreferrer">{t.github}</a> : null}{settings.website_url ? <a className="text-blue-600 hover:underline" href={settings.website_url} target="_blank" rel="noreferrer">{t.website}</a> : null}</div>
          <button onClick={toggleKillSwitch} disabled={loading} className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium ${killSwitch ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'}`}>{killSwitch ? `${t.killSwitch}: ON` : `${t.killSwitch}: OFF`}</button>
          <button onClick={logout} className="w-full flex items-center justify-center gap-2 px-3 py-2 mt-2 rounded-md text-sm text-red-600 hover:bg-red-50"><LogOut className="w-4 h-4" />{t.logout}</button>
        </div>
      </div>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}