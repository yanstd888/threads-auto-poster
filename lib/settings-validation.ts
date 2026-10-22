import {
  DEFAULT_MINIMUM_POST_GAP_MINUTES,
  getDailySlotCapacity,
  isValidScheduleTimeZone,
  MAX_MINIMUM_POST_GAP_MINUTES,
  MAX_POSTS_PER_DAY,
  MIN_SCHEDULE_GAP_MINUTES,
} from './scheduler';

export const REPLY_SETTING_KEYS = new Set([
  'reply_agent_enabled',
  'reply_posting_mode',
  'reply_daily_max',
  'reply_unique_accounts_daily_max',
  'reply_per_account_daily_max',
  'reply_account_policy',
  'reply_min_gap_minutes',
  'reply_active_hours_start',
  'reply_active_hours_end',
  'reply_active_days',
  'reply_discovery_interval_minutes',
  'reply_max_post_age_hours',
  'reply_relevance_threshold',
  'reply_language_mode',
  'reply_auto_score_threshold',
  'reply_auto_mode_approved',
]);

export const SCHEDULE_KEYS = new Set([
  'posts_per_day',
  'active_hours_start',
  'active_hours_end',
  'active_days',
  'timezone',
  'pillar_weights',
  'promo_ratio',
  'minimum_post_gap_minutes',
]);

export const ALLOWED_SETTING_KEYS = new Set([
  ...SCHEDULE_KEYS,
  ...REPLY_SETTING_KEYS,
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
  'minimum_post_gap_minutes',
  'promo_offer',
  'promo_reason',
  'posting_mode',
  'hermes_provider',
  'hermes_model',
  'hermes_profile',
  'ui_locale',
  'content_locale',
  ...REPLY_SETTING_KEYS,
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
  if (key === 'minimum_post_gap_minutes') return integerInRange(value, MIN_SCHEDULE_GAP_MINUTES, MAX_MINIMUM_POST_GAP_MINUTES, `Jarak minimum harus ${MIN_SCHEDULE_GAP_MINUTES}–${MAX_MINIMUM_POST_GAP_MINUTES} menit`);
  if (key === 'reply_agent_enabled' || key === 'reply_auto_mode_approved') return value === 'true' || value === 'false' ? value : new Error('Reply agent switch tidak valid');
  if (key === 'reply_posting_mode') return value === 'approval' || value === 'auto' ? value : new Error('Reply posting mode tidak valid');
  if (key === 'reply_daily_max') return integerInRange(value, 0, 1000, 'Maksimum reply/hari harus 0–1000');
  if (key === 'reply_unique_accounts_daily_max') return integerInRange(value, 0, 1000, 'Maksimum akun unik/hari harus 0–1000');
  if (key === 'reply_per_account_daily_max') return integerInRange(value, 0, 100, 'Maksimum reply per akun harus 0–100');
  if (key === 'reply_account_policy') return ['once', 'continuations_only'].includes(value) ? value : new Error('Kebijakan akun reply tidak valid');
  if (key === 'reply_min_gap_minutes') return integerInRange(value, 1, 1440, 'Jarak reply harus 1–1440 menit');
  if (key === 'reply_active_hours_start') return integerInRange(value, 0, 22, 'Jam mulai reply harus 0–22');
  if (key === 'reply_active_hours_end') return integerInRange(value, 1, 23, 'Jam selesai reply harus 1–23');
  if (key === 'reply_active_days') return validateActiveDays(value, 'Pilih minimal satu hari aktif untuk reply');
  if (key === 'reply_discovery_interval_minutes') return integerInRange(value, 5, 1440, 'Interval discovery harus 5–1440 menit');
  if (key === 'reply_max_post_age_hours') return integerInRange(value, 1, 720, 'Umur post maksimum harus 1–720 jam');
  if (key === 'reply_relevance_threshold' || key === 'reply_auto_score_threshold') return integerInRange(value, 0, 100, 'Threshold relevance harus 0–100');
  if (key === 'reply_language_mode') return ['match_target', 'id', 'en'].includes(value) ? value : new Error('Mode bahasa reply tidak valid');
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
  const gap = Number(key === 'minimum_post_gap_minutes' ? value : settings.minimum_post_gap_minutes || DEFAULT_MINIMUM_POST_GAP_MINUTES);
  if (end <= start) return 'Jam selesai harus setelah jam mulai';
  const capacity = getDailySlotCapacity(start, end, gap);
  if (postsPerDay > capacity) return `Rentang jam aktif hanya menampung maksimal ${capacity} post/hari dengan jarak minimum ${gap} menit`;
  return null;
}

export function validateReplyScheduleWindow(key: string, value: string, settings: Readonly<Record<string, string>>): string | null {
  if (!REPLY_SETTING_KEYS.has(key)) return null;
  const start = Number(key === 'reply_active_hours_start' ? value : settings.reply_active_hours_start || '8');
  const end = Number(key === 'reply_active_hours_end' ? value : settings.reply_active_hours_end || '20');
  if (end <= start) return 'Jam selesai reply harus setelah jam mulai';
  return null;
}

function validateActiveDays(value: string, emptyMessage: string): string | Error {
  try {
    const rawDays: unknown = JSON.parse(value);
    if (!Array.isArray(rawDays)) return new Error('Format hari aktif tidak valid');
    const days = [...new Set(rawDays.filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6))];
    return days.length > 0 ? JSON.stringify(days) : new Error(emptyMessage);
  } catch {
    return new Error('Format hari aktif tidak valid');
  }
}

function integerInRange(value: string, min: number, max: number, error: string): string | Error {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? String(number) : new Error(error);
}
