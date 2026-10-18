import * as cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { DatabaseSync } from 'node:sqlite';
import { getDb, getSetting, setSetting, logAudit } from './db';
import { publishStoredPost } from './publish';
import { createScheduledPost } from './schedule-content';
import { captureDueSnapshotsForAll, syncRecentThreadMetrics } from './metrics';
import { pruneExpiredSourceSnapshots } from './source-context';
import { cancelActiveHermesAgent } from './hermes';
import { getContentPillar, getContentPillars } from './content-pillars';

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

interface ScheduleConfig {
  postsPerDay: number;
  hourStart: number;
  hourEnd: number;
  activeDays: number[];
  timezone: string;
}

interface ScheduleRow {
  id: number;
  slot_time: number;
  pillar: string;
  post_type: 'education' | 'promotion';
  status: string;
  retry_count: number;
  retry_at: number | null;
  last_error: string | null;
  post_id?: number | null;
  post_status?: string | null;
  quality_status?: string | null;
  threads_id?: string | null;
}

interface PostRow { id: number; status: string; quality_status: string }
interface PreparingRow { id: number; pillar: string; post_type: string; slot_time: number }
interface AuditRow { action: string; details: string; created_at: number }
interface SchedulerStatusRow extends ScheduleRow {
  content: string | null;
  replies: string | null;
  source_urls: string | null;
  quality_reasons: string | null;
  threads_url: string | null;
}

const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_ACTIVE_DAYS = [0, 1, 2, 3, 4, 5, 6];
const PLAN_VERSION = 'stable-v4-dynamic-pillar-mix';
const PLANNING_DAYS = 7;
const TIMER_HORIZON_MS = 24 * 60 * 60 * 1000;
const PREPARATION_HORIZON_MS = 48 * 60 * 60 * 1000;
const PREPARATION_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const DAY_PEAK_MINUTES = [11 * 60, 12 * 60, 10 * 60, 12 * 60, 9 * 60, 10 * 60, 10 * 60];

const PREPARATION_HEARTBEAT_MS = 5_000;
const PREPARATION_STALE_MS = 15_000;
const MAX_AUTO_UPLOAD_RETRIES = 3;
export const MAX_CONTENT_PREPARATION_ATTEMPTS = 3;
const MAX_CONTENT_RETRY_DELAY_MS = 8 * 60 * 1000;
const MAX_PREPARATION_WORKERS = 3;
const MISSED_SLOT_CATCHUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const MISSED_SLOT_CATCHUP_INTERVAL_MS = 10 * 60 * 1000;
export const MIN_SCHEDULE_GAP_MINUTES = 5;
const DEFAULT_MAX_POSTS_PER_DAY = 288;
const configuredMaxPosts = Number.parseInt(process.env.MAX_POSTS_PER_DAY || '', 10);
export const MAX_POSTS_PER_DAY = Number.isInteger(configuredMaxPosts) && configuredMaxPosts > 0
  ? Math.min(configuredMaxPosts, DEFAULT_MAX_POSTS_PER_DAY)
  : DEFAULT_MAX_POSTS_PER_DAY;
const SCHEDULER_STARTED_KEY = '__threadsAutoPosterSchedulerStarted';

let cronJobs: ScheduledTask[] = [];
const slotTimers = new Map<number, ReturnType<typeof setTimeout>>();
const contentPreparationTimers = new Map<string, ReturnType<typeof setTimeout>>();
let missedSlotCatchupTimer: ReturnType<typeof setTimeout> | null = null;

export function ensureSchedulerRunning() {
  if (cronJobs.length === 0) startScheduler();
}

export function startScheduler() {
  const runtime = globalThis as typeof globalThis & { [SCHEDULER_STARTED_KEY]?: boolean };
  if (runtime[SCHEDULER_STARTED_KEY]) return;
  runtime[SCHEDULER_STARTED_KEY] = true;
  clearSlotTimers();
  clearContentPreparationTimer();
  clearMissedSlotCatchupTimer();
  stopCronJobs();

  const config = getScheduleConfig();
  const schedulerDb = getDb();
  schedulerDb.exec('CREATE TABLE IF NOT EXISTS scheduler_locks (name TEXT PRIMARY KEY, locked_at INTEGER NOT NULL)');
  recoverStalePreparations(schedulerDb);
  cronJobs.push(cron.schedule('0 * * * *', () => recomputeAndSchedule(), { timezone: config.timezone }));
  cronJobs.push(cron.schedule('*/5 * * * *', () => { void retryFailedPosts(); }, { timezone: config.timezone }));
  cronJobs.push(cron.schedule('*/10 * * * *', () => { void syncRecentThreadMetrics(); void captureDueSnapshotsForAll(); }, { timezone: config.timezone }));
  cronJobs.push(cron.schedule('* * * * *', () => {
    if (recoverStalePreparations(getDb()) && getSetting('kill_switch') !== 'true') scheduleNextContentPreparation();
  }, { timezone: config.timezone }));

  if (getSetting('schedule_plan_version') !== PLAN_VERSION) {
    rebalanceFutureSchedule(config);
    setSetting('schedule_plan_version', PLAN_VERSION);
  }

  void recoverInterruptedSlots().finally(() => {
    recomputeAndSchedule();
    scheduleMissedSlotCatchup();
  });
  void retryFailedPosts();
  void syncRecentThreadMetrics();
  logAudit('scheduler_started', `timezone=${config.timezone}`);
}

export function stopScheduler() {
  (globalThis as typeof globalThis & { [SCHEDULER_STARTED_KEY]?: boolean })[SCHEDULER_STARTED_KEY] = false;
  clearSlotTimers();
  clearContentPreparationTimer();
  clearMissedSlotCatchupTimer();
  stopCronJobs();
  logAudit('scheduler_stopped', 'Scheduler stopped');
}

export function refreshSchedule() {
  clearSlotTimers();
  clearContentPreparationTimer();
  const removed = getDb().prepare("DELETE FROM schedule WHERE status = 'pending' AND slot_time > ? AND NOT EXISTS (SELECT 1 FROM posts WHERE posts.schedule_id = schedule.id AND posts.status <> 'quality_failed')").run(Date.now());
  recomputeAndSchedule();
  logAudit('schedule_refreshed', `pending_slots_removed=${removed.changes}`);
}

function stopCronJobs() {
  for (const job of cronJobs) job.stop?.();
  cronJobs = [];
}

function clearSlotTimers() {
  for (const timer of slotTimers.values()) clearTimeout(timer);
  slotTimers.clear();
}

function clearContentPreparationTimer() {
  for (const timer of contentPreparationTimers.values()) clearTimeout(timer);
  contentPreparationTimers.clear();
}

function clearMissedSlotCatchupTimer() {
  if (!missedSlotCatchupTimer) return;
  clearTimeout(missedSlotCatchupTimer);
  missedSlotCatchupTimer = null;
}

function recomputeAndSchedule() {
  clearSlotTimers();
  recoverStalePreparations(getDb());
  const expiredSnapshots = pruneExpiredSourceSnapshots(getDb());
  if (expiredSnapshots) logAudit('source_snapshots_pruned', `deleted=${expiredSnapshots}`);
  if (getSetting('kill_switch') === 'true') {
    logAudit('scheduler_skip', 'Kill switch active');
    return;
  }

  const config = getScheduleConfig();
  ensureFutureSlots(config);
  armPendingSlots();
  if (getSetting('content_agent_enabled') !== 'false') scheduleNextContentPreparation();
}

export function recoverStalePreparations(db: DatabaseSync, now = Date.now()): boolean {
  const stalePillars = db.prepare("SELECT substr(name, length('content-preparation:') + 1) AS pillar FROM scheduler_locks WHERE name LIKE 'content-preparation:%' AND locked_at < ?")
    .all(now - PREPARATION_STALE_MS) as { pillar: string }[];
  if (stalePillars.length === 0) return false;
  const staleLocks = Number(db.prepare("DELETE FROM scheduler_locks WHERE name LIKE 'content-preparation:%' AND locked_at < ?")
    .run(now - PREPARATION_STALE_MS).changes);
  const resetSlot = db.prepare("UPDATE schedule SET status = 'pending' WHERE status = 'preparing' AND pillar = ? AND slot_time > ? AND NOT EXISTS (SELECT 1 FROM posts WHERE posts.schedule_id = schedule.id AND posts.status <> 'quality_failed')");
  const reset = stalePillars.reduce((count, { pillar }) => count + Number(resetSlot.run(pillar, now).changes), 0);
  logAudit('stale_preparation_recovered', `locks=${staleLocks} slots=${reset}`, db);
  return true;
}

function ensureFutureSlots(config: ScheduleConfig) {
  const db = getDb();
  const now = Date.now();
  const today = getZonedDate(now, config.timezone);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO schedule (slot_time, pillar, post_type, status) VALUES (?, ?, ?, ?)',
  );

  for (let offset = 0; offset < PLANNING_DAYS; offset++) {
    const date = addDays(today, offset);
    const dayOfWeek = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
    if (!config.activeDays.includes(dayOfWeek)) continue;

    const slotTimes = planDailySlotTimes(date, config.postsPerDay, config.hourStart, config.hourEnd, config.timezone);
    const pillars = planDailyPillars(slotTimes.length);
    for (let slotIndex = 0; slotIndex < slotTimes.length; slotIndex++) {
      const slotTime = slotTimes[slotIndex];
      if (slotTime <= now + 60 * 1000) continue;
      const { pillar, postType } = selectPillarAndType(`${date.year}-${date.month}-${date.day}:${slotTime}`, pillars[slotIndex]);
      insert.run(slotTime, pillar, postType, 'pending');
    }
  }
}

export function planDailyPillars(count: number): string[] {
  const safeCount = Math.max(0, Math.floor(count));
  const pillars = getContentPillars(getDb(), true);
  if (pillars.length === 0) return [];
  const totalWeight = pillars.reduce((sum, pillar) => sum + Math.max(0, pillar.weight), 0);
  if (totalWeight === 0) return Array.from({ length: safeCount }, (_, index) => pillars[index % pillars.length].slug);

  const counts = new Map(pillars.map(pillar => [pillar.slug, 0]));
  return Array.from({ length: safeCount }, (_, index) => {
    const selected = pillars.reduce((best, pillar) => {
      const desired = ((index + 1) * Math.max(0, pillar.weight)) / totalWeight;
      const deficit = desired - (counts.get(pillar.slug) || 0);
      const bestDeficit = desired - (counts.get(best.slug) || 0);
      return deficit > bestDeficit ? pillar : best;
    }, pillars[0]);
    counts.set(selected.slug, (counts.get(selected.slug) || 0) + 1);
    return selected.slug;
  });
}

export function getDailySlotCapacity(hourStart: number, hourEnd: number): number {
  const start = clampInt(hourStart, 8, 0, 22);
  const end = clampInt(hourEnd, 20, 1, 23);
  if (end <= start) return 0;
  const firstMinute = start * 60 + 10;
  const lastMinute = end * 60 - 10;
  return Math.floor((lastMinute - firstMinute) / MIN_SCHEDULE_GAP_MINUTES) + 1;
}

export function planDailySlotTimes(
  date: LocalDate,
  postsPerDay: number,
  hourStart: number,
  hourEnd: number,
  timezone: string,
): number[] {
  const start = clampInt(hourStart, 8, 0, 22);
  const end = clampInt(hourEnd, 20, 1, 23);
  if (end <= start) return [];

  const firstMinute = start * 60 + 10;
  const lastMinute = end * 60 - 10;
  const maxSlots = getDailySlotCapacity(start, end);
  const count = Math.min(clampInt(postsPerDay, 3, 1, MAX_POSTS_PER_DAY), Math.max(0, maxSlots));
  if (count === 0) return [];

  const span = lastMinute - firstMinute;
  const nominalGap = span / count;
  const minGap = count === 1 ? 0 : Math.max(MIN_SCHEDULE_GAP_MINUTES, Math.floor(nominalGap) - 10);
  const dayOfWeek = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  const peak = DAY_PEAK_MINUTES[dayOfWeek];
  const rawAnchorIndex = Math.round((peak - (firstMinute + nominalGap / 2)) / nominalGap);
  const anchorIndex = Math.min(count - 1, Math.max(0, rawAnchorIndex));
  const earliestAnchor = firstMinute + anchorIndex * minGap;
  const latestAnchor = lastMinute - (count - anchorIndex - 1) * minGap;
  const anchor = clamp(peak, earliestAnchor, latestAnchor);
  const jitterLimit = Math.min(8, Math.max(3, Math.floor(minGap / 8)));

  const minutes = Array.from({ length: count }, (_, index) => {
    const center = firstMinute + nominalGap * (index + 0.5);
    const jitter = index === anchorIndex ? 0 : deterministicJitter(`${date.year}-${date.month}-${date.day}:${index}`, jitterLimit);
    return clamp(Math.round(center + jitter), firstMinute, lastMinute);
  });
  minutes[anchorIndex] = anchor;

  for (let index = anchorIndex - 1; index >= 0; index--) {
    minutes[index] = Math.min(minutes[index], minutes[index + 1] - minGap);
  }
  for (let index = anchorIndex + 1; index < minutes.length; index++) {
    minutes[index] = Math.max(minutes[index], minutes[index - 1] + minGap);
  }

  return minutes.map(minute => zonedDateTimeToEpoch(date, minute, timezone));
}

async function retryFailedPosts() {
  // ponytail: retry only provider-confirmed-safe failures, capped at three attempts; unknown publishes are excluded.
  if (getSetting('kill_switch') === 'true') return;
  const db = getDb();
  const posts = db.prepare(`
    SELECT id, schedule_id FROM posts
    WHERE status = 'failed' AND threads_id IS NULL AND retry_count < ?
    ORDER BY created_at ASC LIMIT 10
  `).all(MAX_AUTO_UPLOAD_RETRIES) as { id: number; schedule_id: number | null }[];

  for (const post of posts) {
    const result = await publishStoredPost(post.id, ['failed']);
    if (result.kind === 'posted' || result.kind === 'already_posted') {
      if (post.schedule_id) db.prepare("UPDATE schedule SET status = 'completed', last_error = NULL WHERE id = ?").run(post.schedule_id);
      logAudit('post_auto_retry_success', `post ${post.id}: ${result.kind}`);
      continue;
    }
    const error = result.kind === 'failed' ? result.error : `Publikasi tidak selesai: ${result.kind}`;
    if (post.schedule_id) db.prepare("UPDATE schedule SET status = 'failed', last_error = ? WHERE id = ?").run(error, post.schedule_id);
    logAudit('post_auto_retry_failed', `post ${post.id}: ${error}`);
  }
}

async function recoverInterruptedSlots() {
  if (getSetting('kill_switch') === 'true') return;
  const db = getDb();
  const now = Date.now();
  const slots = db.prepare(`
    SELECT s.*, p.id AS post_id, p.status AS post_status
    FROM schedule s
    LEFT JOIN posts p ON p.schedule_id = s.id AND p.status <> 'quality_failed'
    WHERE s.slot_time BETWEEN ? AND ? AND s.status IN ('preparing', 'processing')
    ORDER BY s.slot_time ASC
  `).all(now - MISSED_SLOT_CATCHUP_WINDOW_MS, now) as unknown as ScheduleRow[];

  for (const slot of slots) {
    if (slot.post_status === 'publishing' && slot.post_id != null) {
      // ponytail: a killed process may have reached Meta; require read-back/manual resolution rather than risk a duplicate post.
      db.prepare("UPDATE posts SET status = 'publish_unknown' WHERE id = ? AND status = 'publishing'").run(slot.post_id);
      db.prepare("UPDATE schedule SET status = 'failed', last_error = ? WHERE id = ?").run('App restarted while publishing; verify before retry.', slot.id);
      logAudit('slot_publish_unknown', `slot ${slot.id}: post ${slot.post_id}`);
      continue;
    }
    db.prepare("UPDATE schedule SET status = 'pending', last_error = NULL WHERE id = ? AND status IN ('preparing', 'processing')").run(slot.id);
    logAudit('slot_catchup', `slot ${slot.id}: resume after restart`);
    await executeSlot({ ...slot, status: 'pending' }, true);
  }
}

// ponytail: recovery only publishes already-approved drafts, one every ten minutes; it never regenerates or retries ambiguous posts.
function scheduleMissedSlotCatchup() {
  if (missedSlotCatchupTimer || getSetting('kill_switch') === 'true') return;
  const next = getNextMissedScheduledSlot(getDb(), Date.now());
  if (!next) return;
  missedSlotCatchupTimer = setTimeout(() => {
    missedSlotCatchupTimer = null;
    void runMissedSlotCatchup();
  }, MISSED_SLOT_CATCHUP_INTERVAL_MS);
  logAudit('slot_catchup_queued', `slot ${next.id}: publish in 10 minutes`);
}

async function runMissedSlotCatchup() {
  if (getSetting('kill_switch') === 'true') return;
  const slot = getNextMissedScheduledSlot(getDb(), Date.now());
  if (slot) {
    logAudit('slot_catchup_executing', `slot ${slot.id}: overdue=${Math.round((Date.now() - slot.slot_time) / 60_000)}m`);
    await executeSlot(slot, true);
  }
  scheduleMissedSlotCatchup();
}

export function getNextMissedScheduledSlot(db: DatabaseSync, now = Date.now()): ScheduleRow | null {
  const slot = db.prepare(`
    SELECT s.*
    FROM schedule s
    JOIN posts p ON p.schedule_id = s.id
    WHERE s.slot_time BETWEEN ? AND ?
      AND s.status = 'pending'
      AND p.status = 'scheduled'
      AND p.quality_status = 'passed'
      AND p.threads_id IS NULL
    ORDER BY s.slot_time ASC, p.id ASC
    LIMIT 1
  `).get(now - MISSED_SLOT_CATCHUP_WINDOW_MS, now) as ScheduleRow | undefined;
  return slot || null;
}

function armPendingSlots() {
  const now = Date.now();
  const pendingSlots = getDb().prepare(
    "SELECT * FROM schedule WHERE status = 'pending' AND slot_time > ? AND slot_time <= ? ORDER BY slot_time ASC",
  ).all(now, now + TIMER_HORIZON_MS) as unknown as ScheduleRow[];

  for (const slot of pendingSlots) {
    const delay = slot.slot_time - now;
    if (delay <= 0 || slotTimers.has(slot.id)) continue;
    const timer = setTimeout(() => {
      slotTimers.delete(slot.id);
      void executeSlot(slot);
    }, delay);
    slotTimers.set(slot.id, timer);
  }
}

function queueContentPreparation(pillar: string, delayMs = 0) {
  if (contentPreparationTimers.has(pillar)) return;
  const timer = setTimeout(() => {
    contentPreparationTimers.delete(pillar);
    void prepareOnePendingSlot(pillar);
  }, Math.max(0, delayMs));
  contentPreparationTimers.set(pillar, timer);
}

function scheduleNextContentPreparation() {
  const db = getDb();
  const now = Date.now();
  if (getSetting('kill_switch') === 'true' || getSetting('content_agent_enabled') === 'false') return;
  const available = availablePreparationWorkers(db, contentPreparationTimers.size, now);
  if (available === 0) return;
  const activePillars = new Set((db.prepare("SELECT substr(name, length('content-preparation:') + 1) AS pillar FROM scheduler_locks WHERE name LIKE 'content-preparation:%' AND locked_at >= ?")
    .all(now - PREPARATION_STALE_MS) as { pillar: string }[]).map(lock => lock.pillar));
  const candidates = getContentPillars(db, true)
    .map(pillar => pillar.slug)
    .map(pillar => getNextPreparationSlot(db, now, pillar))
    .filter((slot): slot is ScheduleRow => slot !== null)
    .filter(slot => !activePillars.has(slot.pillar) && !contentPreparationTimers.has(slot.pillar))
    .sort((a, b) => a.slot_time - b.slot_time)
    .slice(0, available);
  for (const slot of candidates) {
    const retryAt = slot.status === 'retrying' ? Math.max(now, Number(slot.retry_at) || now) : now;
    queueContentPreparation(slot.pillar, retryAt - now);
  }
}

export function availablePreparationWorkers(db: DatabaseSync, queuedWorkers = 0, now = Date.now()): number {
  const activeWorkers = db.prepare("SELECT COUNT(*) AS count FROM scheduler_locks WHERE name LIKE 'content-preparation:%' AND locked_at >= ?")
    .get(now - PREPARATION_STALE_MS) as { count: number };
  return Math.max(0, MAX_PREPARATION_WORKERS - Number(activeWorkers.count) - queuedWorkers);
}

// ponytail: one worker per pillar; increase MAX_PREPARATION_WORKERS only when the agent/provider has measured spare capacity.
export function getNextPreparationSlot(db: DatabaseSync, now: number, pillar?: string): ScheduleRow | null {
  const pillarFilter = pillar ? 'AND s.pillar = ?' : '';
  const slot = db.prepare(`
    SELECT s.* FROM schedule s
    WHERE s.slot_time > ? AND s.slot_time <= ? AND s.status IN ('pending', 'retrying')
      ${pillarFilter}
      AND NOT EXISTS (
        SELECT 1 FROM posts p WHERE p.schedule_id = s.id AND p.status <> 'quality_failed'
      )
    ORDER BY s.slot_time ASC LIMIT 1
  `).get(now - PREPARATION_LOOKBACK_MS, now + PREPARATION_HORIZON_MS, ...(pillar ? [pillar] : [])) as ScheduleRow | undefined;
  return slot || null;
}

export function contentPreparationRetryDelayMs(retryCount: number): number {
  return Math.min(MAX_CONTENT_RETRY_DELAY_MS, 60_000 * 2 ** Math.max(0, Math.floor(retryCount)));
}

export type PreparationErrorKind = 'source_transient' | 'source_dead' | 'agent_timeout' | 'agent_crash' | 'invalid_json' | 'quality_reject' | 'publish_unknown';

export function classifyPreparationError(error: string): PreparationErrorKind {
  const value = error.toLowerCase();
  if (value.includes('quality')) return 'quality_reject';
  if (value.includes('publish_unknown')) return 'publish_unknown';
  if (value.includes('source_transient')) return 'source_transient';
  if (value.includes('timeout')) return value.includes('source') ? 'source_transient' : 'agent_timeout';
  if (value.includes('invalid_json') || value.includes('json')) return 'invalid_json';
  if (value.includes('blocked_source') || value.includes('redirect') || value.includes('source_dead')) return 'source_dead';
  if (value.includes('fetch failed') || value.includes('dns') || value.includes('network')) return 'source_transient';
  return 'agent_crash';
}

export function isBlockedSourceError(error: string): boolean {
  return error === 'blocked_source'
    || error.includes('Semua tema/sumber utama')
    || error.includes('Tidak ada URL GitHub repo/skill approved');
}

export function shouldRetryPreparationUntilSlot(kind: PreparationErrorKind): boolean {
  return kind === 'source_transient' || kind === 'agent_timeout' || kind === 'agent_crash' || kind === 'invalid_json' || kind === 'quality_reject';
}

function markPreparationRetry(slot: ScheduleRow, error: string, qualityFailure = false) {
  const kind = classifyPreparationError(error);
  const labeledError = `${kind}: ${error}`;
  const db = getDb();
  const nextAttempt = (Number(slot.retry_count) || 0) + 1;
  const retryUntilSlot = shouldRetryPreparationUntilSlot(kind);
  const maxAttempts = MAX_CONTENT_PREPARATION_ATTEMPTS;
  const terminalStatus = qualityFailure ? 'blocked_quality' : retryUntilSlot ? 'blocked_agent' : 'failed';
  const retryAt = Date.now() + contentPreparationRetryDelayMs(Number(slot.retry_count) || 0);
  if (retryAt < slot.slot_time && (retryUntilSlot || nextAttempt < maxAttempts)) {
    db.prepare("UPDATE schedule SET status = 'retrying', retry_at = ?, retry_count = ?, last_error = ? WHERE id = ?").run(retryAt, nextAttempt, labeledError, slot.id);
    logAudit('schedule_prepare_retry', `slot ${slot.id}: retry ${nextAttempt}${retryUntilSlot ? ' until slot' : `/${maxAttempts}`} in ${Math.round((retryAt - Date.now()) / 1000)}s: ${labeledError}`);
    return;
  }
  db.prepare("UPDATE schedule SET status = ?, retry_at = NULL, retry_count = ?, last_error = ? WHERE id = ?").run(terminalStatus, nextAttempt, labeledError, slot.id);
  logAudit('schedule_prepare_failed', `slot ${slot.id}: ${retryAt < slot.slot_time ? `attempts=${nextAttempt}` : 'no time left before slot'}: ${labeledError}`);
}

async function prepareOnePendingSlot(pillar: string) {
  if (getSetting('content_agent_enabled') === 'false' || getSetting('kill_switch') === 'true') return;
  const db = getDb();
  const lockName = `content-preparation:${pillar}`;
  db.exec('CREATE TABLE IF NOT EXISTS scheduler_locks (name TEXT PRIMARY KEY, locked_at INTEGER NOT NULL)');
  const now = Date.now();
  const lock = db.prepare(`
    INSERT INTO scheduler_locks (name, locked_at) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET locked_at = excluded.locked_at
    WHERE scheduler_locks.locked_at < ?
  `).run(lockName, now, now - PREPARATION_STALE_MS);
  if (lock.changes === 0) {
    queueContentPreparation(pillar, 5_000);
    return;
  }

  const heartbeat = setInterval(() => {
    db.prepare('UPDATE scheduler_locks SET locked_at = ? WHERE name = ?').run(Date.now(), lockName);
  }, PREPARATION_HEARTBEAT_MS);
  try {
    const slot = getNextPreparationSlot(db, now, pillar);
    if (!slot || (slot.status === 'retrying' && Number(slot.retry_at) > now)) return;

    if (db.prepare("UPDATE schedule SET status = 'preparing' WHERE id = ? AND status IN ('pending', 'retrying')").run(slot.id).changes === 0) return;
    try {
      const result = await createScheduledPost(slot);
      if ('error' in result) {
        if (getSetting('content_agent_enabled') === 'false') {
          db.prepare("UPDATE schedule SET status = 'pending', retry_at = NULL, last_error = NULL WHERE id = ?").run(slot.id);
          return;
        }
        const preparationError = result.error || 'unknown_error';
        if (isBlockedSourceError(preparationError)) {
          db.prepare("UPDATE schedule SET status = 'blocked_source', retry_at = NULL, last_error = ? WHERE id = ?").run(preparationError, slot.id);
          logAudit('schedule_prepare_failed', `slot ${slot.id}: blocked_source: ${preparationError}`);
        } else markPreparationRetry(slot, preparationError);
      } else if (!result.qualityPassed) {
        markPreparationRetry(slot, 'quality_gate', true);
      } else {
        db.prepare("UPDATE schedule SET status = 'pending', retry_at = NULL, last_error = NULL WHERE id = ?").run(slot.id);
        logAudit('schedule_prepared', `slot ${slot.id}: post=${result.postId} status=${result.status}`);
        if (slot.slot_time <= Date.now()) {
          const dueSlot = db.prepare('SELECT * FROM schedule WHERE id = ?').get(slot.id) as ScheduleRow | undefined;
          if (dueSlot) await executeSlot(dueSlot, true);
        }
      }
    } catch (error: unknown) {
      markPreparationRetry(slot, error instanceof Error ? error.message : String(error));
    }
  } finally {
    clearInterval(heartbeat);
    db.prepare('DELETE FROM scheduler_locks WHERE name = ?').run(lockName);
    armPendingSlots();
    if (getSetting('kill_switch') !== 'true') scheduleNextContentPreparation();
  }
}

function selectPillarAndType(seed: string, pillarOverride?: string): { pillar: string; postType: 'education' | 'promotion' } {
  const enabledPillars = getContentPillars(getDb(), true);
  const fallback = enabledPillars[0]?.slug || 'umkm';
  const pillar = pillarOverride && enabledPillars.some(item => item.slug === pillarOverride)
    ? pillarOverride
    : enabledPillars[Math.floor(stableUnit(seed) * enabledPillars.length)]?.slug || fallback;
  const promoRatio = Math.min(0.2, Math.max(0, Number(getSetting('promo_ratio') || '0.2')));
  const promoEligible = getContentPillar(pillar)?.promo_eligible ?? false;
  return { pillar, postType: promoEligible && stableUnit(`${seed}:promo`) < promoRatio ? 'promotion' : 'education' };
}

function rebalanceFutureSchedule(config: ScheduleConfig) {
  const db = getDb();
  const now = Date.now();
  const today = getZonedDate(now, config.timezone);
  const start = zonedDateTimeToEpoch(today, 0, config.timezone);
  const end = now + (PLANNING_DAYS + 1) * 24 * 60 * 60 * 1000;
  const rows = db.prepare(`
    SELECT s.id, s.slot_time, s.pillar, s.post_type, s.status,
      p.id AS post_id, p.status AS post_status, p.threads_id
    FROM schedule s
    LEFT JOIN posts p ON p.schedule_id = s.id AND p.status <> 'quality_failed'
    WHERE s.slot_time >= ? AND s.slot_time < ?
    ORDER BY s.slot_time ASC
  `).all(start, end) as unknown as ScheduleRow[];
  const dayIndexes = new Map<string, number>();
  let changed = 0;
  let deletedPosts = 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const date = getZonedDate(row.slot_time, config.timezone);
      const dayKey = `${date.year}-${date.month}-${date.day}`;
      const slotIndex = dayIndexes.get(dayKey) || 0;
      dayIndexes.set(dayKey, slotIndex + 1);
      if (row.slot_time <= now) continue;

      const desired = selectPillarAndType(`${dayKey}:${row.slot_time}`, planDailyPillars(slotIndex + 1)[slotIndex]);
      const changedPillar = row.pillar !== desired.pillar || row.post_type !== desired.postType;
      const protectedPost = row.post_id && (row.threads_id || ['publishing', 'posted', 'published'].includes(row.post_status || ''));
      if (protectedPost) continue;

      if (row.post_id && changedPillar) {
        db.prepare('DELETE FROM posts WHERE id = ? AND schedule_id = ? AND threads_id IS NULL').run(row.post_id, row.id);
        deletedPosts++;
      }
      if (changedPillar || !row.post_id) {
        db.prepare(`UPDATE schedule
          SET pillar = ?, post_type = ?, status = 'pending', retry_at = NULL, retry_count = 0, last_error = NULL
          WHERE id = ?`).run(desired.pillar, desired.postType, row.id);
        changed++;
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  logAudit('schedule_mix_rebalanced', `future_slots=${rows.filter(row => row.slot_time > now).length} changed=${changed} posts_reset=${deletedPosts}`);
}

async function executeSlot(slot: ScheduleRow, allowLateCatchup = false) {
  if (getSetting('kill_switch') === 'true') {
    logAudit('slot_skipped', `slot ${slot.id} skipped: kill switch`);
    return;
  }

  const db = getDb();
  if (!allowLateCatchup && slot.slot_time < Date.now() - 5 * 60 * 1000) {
    db.prepare("UPDATE schedule SET status = 'skipped' WHERE id = ? AND status = 'pending'").run(slot.id);
    logAudit('slot_skipped', `slot ${slot.id} skipped: past catch-up window`);
    return;
  }
  if (db.prepare("UPDATE schedule SET status = 'processing' WHERE id = ? AND status = 'pending'").run(slot.id).changes === 0) {
    logAudit('slot_duplicate', `slot ${slot.id} already processed`);
    return;
  }

  logAudit('slot_executing', `slot ${slot.id}: pillar=${slot.pillar} type=${slot.post_type}`);
  try {
    let post = db.prepare("SELECT id, status, quality_status FROM posts WHERE schedule_id = ? AND status <> 'quality_failed' ORDER BY created_at DESC LIMIT 1").get(slot.id) as PostRow | undefined;
    if (!post) {
      if (getSetting('content_agent_enabled') === 'false') {
        db.prepare("UPDATE schedule SET status = 'blocked_agent' WHERE id = ?").run(slot.id);
        return;
      }
      const prepared = await createScheduledPost(slot);
      if ('error' in prepared) {
        const preparationError = prepared.error || 'agent_crash: Scheduled generation failed';
        if (isBlockedSourceError(preparationError)) {
          db.prepare("UPDATE schedule SET status = 'blocked_source', last_error = ? WHERE id = ?").run(preparationError, slot.id);
        } else {
          markPreparationRetry(slot, preparationError);
        }
        return;
      }
      post = { id: prepared.postId, status: prepared.status, quality_status: prepared.qualityPassed ? 'passed' : 'failed' };
    }
    if (post.quality_status !== 'passed') {
      db.prepare("UPDATE schedule SET status = 'blocked_quality' WHERE id = ?").run(slot.id);
      return;
    }
    if (getSetting('posting_mode') === 'auto') {
      const result = await publishStoredPost(post.id, ['scheduled']);
      if (result.kind === 'posted' || result.kind === 'already_posted') {
        db.prepare("UPDATE schedule SET status = 'completed', last_error = NULL WHERE id = ?").run(slot.id);
        return;
      }
      const error = result.kind === 'failed' ? result.error : `Publikasi tidak selesai: ${result.kind}`;
      db.prepare("UPDATE schedule SET status = 'failed', last_error = ? WHERE id = ?").run(error, slot.id);
      logAudit('slot_publish_failed', `slot ${slot.id}: ${error}`);
      return;
    }
    db.prepare("UPDATE schedule SET status = 'completed', last_error = NULL WHERE id = ?").run(slot.id);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    markPreparationRetry(slot, message || 'agent_crash: Slot execution failed');
    logAudit('slot_error', `slot ${slot.id}: ${message || 'unknown error'}`);
  }
}

export function toggleKillSwitch(): boolean {
  const next = getSetting('kill_switch') !== 'true';
  setSetting('kill_switch', String(next));
  if (next) {
    clearSlotTimers();
    clearContentPreparationTimer();
  }
  else recomputeAndSchedule();
  logAudit('kill_switch', `set to ${next}`);
  return next;
}

export function getSchedulerStatus() {
  return getDb().prepare(
    `SELECT s.*, p.id AS post_id, p.content, p.replies, p.source_urls,
      p.quality_status, p.quality_reasons, p.status as post_status, p.threads_id, p.threads_url
     FROM schedule s
     LEFT JOIN posts p ON p.schedule_id = s.id AND p.status <> 'quality_failed'
     WHERE s.slot_time > ?
     ORDER BY s.slot_time ASC`,
  ).all(Date.now() - 24 * 60 * 60 * 1000) as unknown as SchedulerStatusRow[];
}

export function setContentAgentEnabled(enabled: boolean) {
  const db = getDb();
  db.exec('CREATE TABLE IF NOT EXISTS scheduler_locks (name TEXT PRIMARY KEY, locked_at INTEGER NOT NULL)');
  setSetting('content_agent_enabled', String(enabled));
  clearContentPreparationTimer();
  if (enabled) {
    recoverStalePreparations(db);
    db.prepare("UPDATE schedule SET status = 'pending' WHERE status = 'blocked_agent' AND slot_time > ? AND NOT EXISTS (SELECT 1 FROM posts WHERE posts.schedule_id = schedule.id AND posts.status <> 'quality_failed')").run(Date.now() - PREPARATION_LOOKBACK_MS);
    if (getSetting('kill_switch') !== 'true') scheduleNextContentPreparation();
  } else {
    cancelActiveHermesAgent();
    db.prepare("DELETE FROM scheduler_locks WHERE name LIKE 'content-preparation:%'").run();
    db.prepare("UPDATE schedule SET status = 'pending', retry_at = NULL, last_error = NULL WHERE status = 'preparing' AND slot_time > ? AND NOT EXISTS (SELECT 1 FROM posts WHERE posts.schedule_id = schedule.id AND posts.status <> 'quality_failed')").run(Date.now());
  }
  logAudit('content_agent', enabled ? 'active' : 'inactive');
  return getContentAgentStatus();
}

export function getContentAgentStatus() {
  const db = getDb();
  recoverStalePreparations(db);
  const enabled = getSetting('content_agent_enabled') !== 'false';
  const blockedByKillSwitch = getSetting('kill_switch') === 'true';
  const locks = db.prepare("SELECT locked_at FROM scheduler_locks WHERE name LIKE 'content-preparation:%'").all() as { locked_at: number }[];
  const running = enabled && !blockedByKillSwitch && locks.some(lock => Date.now() - lock.locked_at < PREPARATION_STALE_MS);
  const preparing = running ? db.prepare("SELECT id, pillar, post_type, slot_time FROM schedule WHERE status = 'preparing' ORDER BY slot_time LIMIT 1").get() as PreparingRow | undefined : undefined;
  const now = Date.now();
  const queued = db.prepare("SELECT COUNT(*) AS count FROM schedule s WHERE s.slot_time > ? AND s.slot_time <= ? AND s.status IN ('pending','retrying','preparing') AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.schedule_id = s.id AND p.status <> 'quality_failed')").get(now - PREPARATION_LOOKBACK_MS, now + PREPARATION_HORIZON_MS) as { count: number };
  const ready = db.prepare("SELECT COUNT(*) AS count FROM schedule s JOIN posts p ON p.schedule_id=s.id WHERE s.slot_time > ? AND p.quality_status='passed'").get(Date.now()) as { count: number };
  const latest = db.prepare("SELECT action, details, created_at FROM audit_log WHERE action IN ('hermes_invoke','hermes_response','schedule_prepared','schedule_prepare_retry','schedule_prepare_failed','content_agent') ORDER BY id DESC LIMIT 1").get() as AuditRow | undefined;
  return {
    active: enabled,
    running,
    blocked: blockedByKillSwitch,
    phase: !enabled ? 'inactive' : blockedByKillSwitch ? 'blocked' : preparing ? 'preparing' : queued.count > 0 ? 'queued' : 'idle',
    preparing: preparing || null,
    queued: queued.count,
    ready: ready.count,
    latest: latest || null,
  };
}

function getScheduleConfig(): ScheduleConfig {
  const hourStart = clampInt(getSetting('active_hours_start'), 8, 0, 22);
  const hourEnd = clampInt(getSetting('active_hours_end'), 20, 1, 23);
  return {
    postsPerDay: clampInt(getSetting('posts_per_day'), 3, 1, MAX_POSTS_PER_DAY),
    hourStart,
    hourEnd: hourEnd > hourStart ? hourEnd : 20,
    activeDays: parseActiveDays(getSetting('active_days')),
    timezone: isValidScheduleTimeZone(getSetting('timezone') || '') ? getSetting('timezone')! : DEFAULT_TIMEZONE,
  };
}

function parseActiveDays(value: string | null): number[] {
  try {
    const rawDays: unknown = JSON.parse(value || '[]');
    if (!Array.isArray(rawDays)) return DEFAULT_ACTIVE_DAYS;
    const days = [...new Set(rawDays.filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6))];
    return days.length > 0 ? days : DEFAULT_ACTIVE_DAYS;
  } catch {
    return DEFAULT_ACTIVE_DAYS;
  }
}

export function isValidScheduleTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function getZonedDate(timestamp: number, timezone: string): LocalDate {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp)).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day };
}

function zonedDateTimeToEpoch(date: LocalDate, minuteOfDay: number, timezone: string): number {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const utcGuess = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  let timestamp = utcGuess - getTimeZoneOffsetMs(utcGuess, timezone);
  const correctedOffset = getTimeZoneOffsetMs(timestamp, timezone);
  if (correctedOffset !== getTimeZoneOffsetMs(utcGuess, timezone)) timestamp = utcGuess - correctedOffset;
  return timestamp;
}

function getTimeZoneOffsetMs(timestamp: number, timezone: string): number {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp)).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second) - timestamp;
}

function addDays(date: LocalDate, offset: number): LocalDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + offset));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function deterministicJitter(seed: string, limit: number): number {
  return Math.floor(stableUnit(seed) * (limit * 2 + 1)) - limit;
}

function stableUnit(value: string): number {
  let hash = 0;
  for (const character of value) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return hash / 0x1_0000_0000;
}

function clampInt(value: string | number | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}