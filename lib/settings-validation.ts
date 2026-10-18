import {
  getDailySlotCapacity,
  isValidScheduleTimeZone,
  MAX_POSTS_PER_DAY,
  MIN_SCHEDULE_GAP_MINUTES,
} from './scheduler';

export const SCHEDULE_KEYS = new Set([
  'posts_per_day',
  'active_hours_start',
  'active_hours_end',
  'active_days',
  'timezone',
  'pillar_weights',
  'promo_ratio',
]);

export const ALLOWED_SETTING_KEYS = new Set([
  ...SCHEDULE_KEYS,
  'posting_mode',
  'kill_switch',
  'hermes_model',
  'hermes_profile',
  'hermes_provider',
  'ui_locale',
  'content_locale',
]);

export const EXPORTABLE_SETTING_KEYS = new Set([
  'posts_per_day',
  'active_hours_start',
  'active_hours_end',
  'active_days',
  'timezone',
  'pillar_weights',
  'promo_ratio',
  'promo_offer',
  'promo_reason',
  'posting_mode',
  'hermes_provider',
  'hermes_model',
  'hermes_profile',
  'ui_locale',
  'content_locale',
]);

export function validateSettingValue(key: string, raw: unknown): string | Error {
  const value = String(raw ?? '').trim();
  if (key === 'posts_per_day') return integerInRange(value, 1, MAX_POSTS_PER_DAY, `Posts per day harus 1–${MAX_POSTS_PER_DAY}`);
  if (key === 'active_hours_start') return integerInRange(value, 0, 22, 'Jam mulai harus 0–22');
  if (key === 'active_hours_end') return integerInRange(value, 1, 23, 'Jam selesai harus 1–23');
  if (key === 'timezone') return isValidScheduleTimeZone(value) ? value : new Error('Timezone tidak valid');
  if (key === 'active_days') {
    try {
      const rawDays: unknown = JSON.parse(value);
      if (!Array.isArray(rawDays)) return new Error('Format hari aktif tidak valid');
      const days = [...new Set(rawDays.filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6))];
      return days.length > 0 ? JSON.stringify(days) : new Error('Pilih minimal satu hari aktif');
    } catch {
      return new Error('Format hari aktif tidak valid');
    }
  }
  if (key === 'pillar_weights') {
    try {
      const weights = JSON.parse(value) as unknown;
      if (!weights || typeof weights !== 'object' || Array.isArray(weights)) return new Error('Bobot pilar tidak valid');
      const entries = Object.entries(weights);
      if (!entries.length || entries.some(([, weight]) => !Number.isFinite(Number(weight)) || Number(weight) < 0) || entries.every(([, weight]) => Number(weight) === 0)) {
        return new Error('Bobot pilar tidak valid');
      }
      return JSON.stringify(weights);
    } catch {
      return new Error('Bobot pilar tidak valid');
    }
  }
  if (key === 'promo_ratio') {
    const ratio = Number(value);
    return Number.isFinite(ratio) && ratio >= 0 && ratio <= 0.2 ? String(ratio) : new Error('Promo ratio maksimal 20%');
  }
  if (key === 'ui_locale' || key === 'content_locale') return value === 'id' || value === 'en' ? value : new Error('Locale tidak valid');
  if (key === 'posting_mode') return value === 'approval' || value === 'auto' ? value : new Error('Posting mode tidak valid');
  if (key === 'kill_switch') return value === 'true' || value === 'false' ? value : new Error('Kill switch tidak valid');
  return value.length > 0 && value.length <= 200 ? value : new Error('Nilai setting tidak valid');
}

export function validateScheduleWindow(key: string, value: string, settings: Readonly<Record<string, string>>): string | null {
  if (!SCHEDULE_KEYS.has(key)) return null;
  const postsPerDay = Number(key === 'posts_per_day' ? value : settings.posts_per_day || '3');
  const start = Number(key === 'active_hours_start' ? value : settings.active_hours_start || '8');
  const end = Number(key === 'active_hours_end' ? value : settings.active_hours_end || '20');
  if (end <= start) return 'Jam selesai harus setelah jam mulai';
  const capacity = getDailySlotCapacity(start, end);
  if (postsPerDay > capacity) return `Rentang jam aktif hanya menampung maksimal ${capacity} post/hari dengan jarak minimum ${MIN_SCHEDULE_GAP_MINUTES} menit`;
  return null;
}

function integerInRange(value: string, min: number, max: number, error: string): string | Error {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? String(number) : new Error(error);
}
