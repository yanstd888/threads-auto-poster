'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

export type AppLocale = 'id' | 'en';

type Messages = {
  appName: string;
  dashboard: string;
  content: string;
  schedule: string;
  sources: string;
  settings: string;
  language: string;
  github: string;
  website: string;
  killSwitch: string;
  killSwitchOn: string;
  killSwitchOff: string;
  logout: string;
  login: string;
  password: string;
  signIn: string;
  invalidLogin: string;
};

const messages: Record<AppLocale, Messages> = {
  id: {
    appName: 'Threads Auto Poster', dashboard: 'Dashboard', content: 'Konten', schedule: 'Jadwal', sources: 'Sumber', settings: 'Pengaturan', language: 'Bahasa', github: 'GitHub', website: 'Website', killSwitch: 'Kill switch', killSwitchOn: 'Matikan auto-post', killSwitchOff: 'Nyalakan auto-post', logout: 'Keluar', login: 'Masuk', password: 'Password', signIn: 'Masuk', invalidLogin: 'Password salah',
  },
  en: {
    appName: 'Threads Auto Poster', dashboard: 'Dashboard', content: 'Content', schedule: 'Schedule', sources: 'Sources', settings: 'Settings', language: 'Language', github: 'GitHub', website: 'Website', killSwitch: 'Kill switch', killSwitchOn: 'Disable auto-post', killSwitchOff: 'Enable auto-post', logout: 'Log out', login: 'Log in', password: 'Password', signIn: 'Sign in', invalidLogin: 'Invalid password',
  },
};

type I18nValue = { locale: AppLocale; setLocale: (locale: AppLocale) => void; t: Messages };
const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, onLocaleChange, children }: { locale: AppLocale; onLocaleChange: (locale: AppLocale) => void; children: ReactNode }) {
  const value = useMemo(() => ({ locale, setLocale: onLocaleChange, t: messages[locale] }), [locale, onLocaleChange]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
