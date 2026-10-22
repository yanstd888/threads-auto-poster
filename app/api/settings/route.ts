import { NextRequest, NextResponse } from 'next/server';
import { initDB, setSetting, getAllSettings, getDb, logAudit } from '@/lib/db';
import { requireAuth, requireSameOrigin } from '@/lib/auth';
import { ALLOWED_SETTING_KEYS, SCHEDULE_KEYS, validateReplyScheduleWindow, validateScheduleWindow, validateSettingValue } from '@/lib/settings-validation';
import { getReplyTargets } from '@/lib/reply-targets';
import {
  ensureSchedulerRunning,
  getContentAgentStatus,
  getSchedulerStatus,
  refreshSchedule,
  startScheduler,
  stopScheduler,
  setContentAgentEnabled,
  toggleKillSwitch,
} from '@/lib/scheduler';

const ALLOWED_KEYS = ALLOWED_SETTING_KEYS;

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initDB();
  ensureSchedulerRunning();
  const action = new URL(req.url).searchParams.get('action');

  if (action === 'scheduler_status') return NextResponse.json({ slots: getSchedulerStatus(), agent: getContentAgentStatus() });
  return NextResponse.json({ settings: getAllSettings() });
}

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });

  initDB();
  const body = await req.json();
  if (body.action === 'content_agent') return NextResponse.json(setContentAgentEnabled(body.enabled === true));
  if (body.action === 'scheduler_toggle') return NextResponse.json({ kill_switch: toggleKillSwitch() });
  if (body.action === 'scheduler_restart') {
    if (body.enabled === true) {
      startScheduler();
      return NextResponse.json({ running: true });
    }
    stopScheduler();
    return NextResponse.json({ running: false });
  }
  if (typeof body.key !== 'string' || !ALLOWED_KEYS.has(body.key)) {
    return NextResponse.json({ error: 'Setting tidak didukung' }, { status: 400 });
  }
  if (body.key === 'reply_posting_mode' && body.value === 'auto' && body.confirmAuto !== true) {
    return NextResponse.json({ error: 'Auto mode membutuhkan konfirmasi eksplisit operator' }, { status: 409 });
  }
  if (body.key === 'reply_auto_mode_approved' && body.value === 'true' && body.confirmAuto !== true) {
    return NextResponse.json({ error: 'Persetujuan auto mode tidak valid tanpa konfirmasi eksplisit' }, { status: 409 });
  }
  if (body.key === 'reply_agent_enabled' && body.value === 'true' && !getReplyTargets(getDb(), true).length) {
    return NextResponse.json({ error: 'Tambahkan minimal satu target reply aktif dengan bobot positif terlebih dahulu' }, { status: 400 });
  }

  const value = validateSettingValue(body.key, body.value);
  if (value instanceof Error) return NextResponse.json({ error: value.message }, { status: 400 });

  const windowError = validateScheduleWindow(body.key, value, getAllSettings()) || validateReplyScheduleWindow(body.key, value, getAllSettings());
  if (windowError) return NextResponse.json({ error: windowError }, { status: 400 });

  setSetting(body.key, value);
  if (body.key === 'reply_posting_mode' && value !== 'auto') setSetting('reply_auto_mode_approved', 'false');
  logAudit('setting_changed', `${body.key}=${value}`);

  if (SCHEDULE_KEYS.has(body.key)) {
    ensureSchedulerRunning();
    refreshSchedule();
  } else if (body.key === 'posting_mode' && value === 'auto') {
    ensureSchedulerRunning();
  }

  return NextResponse.json({ success: true, value });
}

