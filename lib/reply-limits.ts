import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from './db';
import type { ReplyQuota } from './reply-api-capabilities';

export interface ReplyLimitSnapshot {
  active: boolean;
  dailyPublished: number;
  distinctAccounts: number;
  accountPublished: number;
  latestPublishedAt: number | null;
  remainingLocal: number;
  remainingOfficial: number | null;
  effectiveRemaining: number;
  reason?: string;
}

export type ReplyAccountPolicy = 'once' | 'continuations_only';

export interface ReplyLimitInput {
  targetUsername: string;
  parentReplyThreadId?: string | null;
}

export function getReplyAccountPolicy(): ReplyAccountPolicy {
  return getSetting('reply_account_policy') === 'continuations_only' ? 'continuations_only' : 'once';
}

export function getReplyAccountPolicyDecision(db: DatabaseSync, input: ReplyLimitInput, excludeCandidateId?: number): { allowed: boolean; reason?: string } {
  const excludeClause = excludeCandidateId == null ? '' : ' AND id <> ?';
  const params: Array<string | number> = [input.targetUsername];
  if (excludeCandidateId != null) params.push(excludeCandidateId);
  const prior = db.prepare(`
    SELECT status, reply_thread_id FROM reply_candidates
    WHERE target_username = ? COLLATE NOCASE
      AND status IN ('posted', 'publishing', 'publish_unknown')${excludeClause}
  `).all(...params) as Array<{ status: string; reply_thread_id: string | null }>;
  if (!prior.length) return { allowed: true };
  if (prior.some(row => row.status === 'publish_unknown')) return { allowed: false, reason: 'reply_account_publish_unknown' };
  if (getReplyAccountPolicy() === 'once') return { allowed: false, reason: 'reply_account_once_limit' };
  const parentReplyThreadId = input.parentReplyThreadId?.trim();
  if (!parentReplyThreadId) return { allowed: false, reason: 'reply_continuation_required' };
  return prior.some(row => row.status === 'posted' && row.reply_thread_id === parentReplyThreadId)
    ? { allowed: true }
    : { allowed: false, reason: 'reply_continuation_parent_unknown' };
}

export function getReplyLimitSnapshot(db: DatabaseSync, input: ReplyLimitInput, officialQuota: ReplyQuota | null, now = Date.now(), excludeCandidateId?: number): ReplyLimitSnapshot {
  const targetUsername = input.targetUsername;
  const timezone = getSetting('timezone') || 'UTC';
  const bounds = zonedDayBounds(now, timezone);
  const dailyMax = Number(getSetting('reply_daily_max') || '10');
  const uniqueMax = Number(getSetting('reply_unique_accounts_daily_max') || '10');
  const perAccountMax = Number(getSetting('reply_per_account_daily_max') || '1');
  const excludeClause = excludeCandidateId == null ? '' : ' AND id <> ?';
  const params: Array<number> = [bounds.start, bounds.end, bounds.start, bounds.end];
  if (excludeCandidateId != null) params.push(excludeCandidateId);
  const rows = db.prepare(`
    SELECT target_username, COALESCE(published_at, publishing_started_at) AS activity_at FROM reply_candidates
    WHERE ((status = 'posted' AND published_at >= ? AND published_at < ?)
       OR (status = 'publishing' AND publishing_started_at >= ? AND publishing_started_at < ?))${excludeClause}
    ORDER BY activity_at DESC
  `).all(...params) as Array<{ target_username: string; activity_at: number }>;
  const dailyPublished = rows.length;
  const distinctAccounts = new Set(rows.map(row => row.target_username.toLowerCase())).size;
  const accountPublished = rows.filter(row => row.target_username.toLowerCase() === targetUsername.toLowerCase()).length;
  const latestPublishedAt = rows[0]?.activity_at || null;
  const active = isReplyActiveWindow(now, timezone);
  const accountPolicy = getReplyAccountPolicyDecision(db, input, excludeCandidateId);
  const gapMinutes = Number(getSetting('reply_min_gap_minutes') || '15');
  let remainingLocal = Math.max(0, dailyMax - dailyPublished);
  let reason: string | undefined;
  if (!active) { remainingLocal = 0; reason = 'reply_outside_active_window'; }
  else if (uniqueMax <= distinctAccounts && accountPublished === 0) { remainingLocal = 0; reason = 'reply_unique_account_limit'; }
  else if (!accountPolicy.allowed) { remainingLocal = 0; reason = accountPolicy.reason; }
  else if (accountPublished >= perAccountMax) { remainingLocal = 0; reason = 'reply_per_account_limit'; }
  else if (latestPublishedAt && latestPublishedAt + gapMinutes * 60_000 > now) { remainingLocal = 0; reason = 'reply_cooldown'; }
  const remainingOfficial = officialQuota ? officialQuota.remaining : null;
  const effectiveRemaining = Math.min(remainingLocal, remainingOfficial ?? 0);
  return { active, dailyPublished, distinctAccounts, accountPublished, latestPublishedAt, remainingLocal, remainingOfficial, effectiveRemaining, ...(reason ? { reason } : {}) };
}

export function isReplyActiveWindow(now = Date.now(), timezone = getSetting('timezone') || 'UTC'): boolean {
  const parts = zonedParts(now, timezone);
  const start = Number(getSetting('reply_active_hours_start') || getSetting('active_hours_start') || '8');
  const end = Number(getSetting('reply_active_hours_end') || getSetting('active_hours_end') || '20');
  const activeDays = parseDays(getSetting('reply_active_days') || getSetting('active_days'));
  return activeDays.includes(parts.weekday) && parts.hour >= start && parts.hour < end;
}

export function zonedDayBounds(now: number, timezone: string): { start: number; end: number } {
  const parts = zonedParts(now, timezone);
  const start = zonedDateTimeToEpoch({ year: parts.year, month: parts.month, day: parts.day }, 0, timezone);
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  const end = zonedDateTimeToEpoch({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }, 0, timezone);
  return { start, end };
}

function parseDays(value: string | null): number[] {
  try {
    const raw = JSON.parse(value || '[]');
    const days = Array.isArray(raw) ? [...new Set(raw.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))] : [];
    return days.length ? days : [0, 1, 2, 3, 4, 5, 6];
  } catch {
    return [0, 1, 2, 3, 4, 5, 6];
  }
}

function zonedParts(timestamp: number, timezone: string): { year: number; month: number; day: number; hour: number; weekday: number } {
  const date = new Date(timestamp);
  const formatted = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const values = Object.fromEntries(formatted.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date);
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, weekday: weekdays[weekday] ?? 0 };
}

function zonedDateTimeToEpoch(date: { year: number; month: number; day: number }, minuteOfDay: number, timezone: string): number {
  const utcGuess = Date.UTC(date.year, date.month - 1, date.day, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  let timestamp = utcGuess - timezoneOffset(utcGuess, timezone);
  const corrected = timezoneOffset(timestamp, timezone);
  if (corrected !== timezoneOffset(utcGuess, timezone)) timestamp = utcGuess - corrected;
  return timestamp;
}

function timezoneOffset(timestamp: number, timezone: string): number {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(timestamp)).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second) - timestamp;
}
