import { NextRequest, NextResponse } from 'next/server';
import { getAllSettings, getDb, initDB, logAudit, setSetting } from '@/lib/db';
import { requireAuth, requireSameOrigin } from '@/lib/auth';
import { getReplyAgentStatus } from '@/lib/reply-agent';
import { getReplyTargets } from '@/lib/reply-targets';
import { probeReplyCapabilities } from '@/lib/reply-api-capabilities';
import { REPLY_SETTING_KEYS, validateReplyScheduleWindow, validateSettingValue } from '@/lib/settings-validation';

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initDB();
  const settings = getAllSettings();
  const probe = new URL(req.url).searchParams.get('probe') === '1';
  return NextResponse.json({
    settings: Object.fromEntries([...REPLY_SETTING_KEYS].map(key => [key, settings[key] || ''])),
    status: getReplyAgentStatus(),
    capabilities: probe ? await probeReplyCapabilities() : null,
  });
}

export async function PATCH(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });
  initDB();
  const body = await req.json() as { key?: unknown; value?: unknown; confirmAuto?: unknown };
  const key = String(body.key || '');
  if (!REPLY_SETTING_KEYS.has(key)) return NextResponse.json({ error: 'Setting reply tidak didukung' }, { status: 400 });
  if (key === 'reply_posting_mode' && body.value === 'auto' && body.confirmAuto !== true) {
    return NextResponse.json({ error: 'Auto mode membutuhkan konfirmasi eksplisit operator' }, { status: 409 });
  }
  if (key === 'reply_auto_mode_approved' && body.value === 'true' && body.confirmAuto !== true) {
    return NextResponse.json({ error: 'Persetujuan auto mode tidak valid tanpa konfirmasi eksplisit' }, { status: 409 });
  }
  if (key === 'reply_agent_enabled' && body.value === 'true' && !getReplyTargets(getDb(), true).length) {
    return NextResponse.json({ error: 'Tambahkan minimal satu target reply aktif dengan bobot positif terlebih dahulu' }, { status: 400 });
  }
  const value = validateSettingValue(key, body.value);
  if (value instanceof Error) return NextResponse.json({ error: value.message }, { status: 400 });
  const windowError = validateReplyScheduleWindow(key, value, getAllSettings());
  if (windowError) return NextResponse.json({ error: windowError }, { status: 400 });
  setSetting(key, value);
  if (key === 'reply_posting_mode' && value !== 'auto') setSetting('reply_auto_mode_approved', 'false');
  logAudit(key === 'reply_agent_enabled' ? (value === 'true' ? 'reply_agent_started' : 'reply_agent_stopped') : 'reply_setting_changed', `${key}=${value}`);
  return NextResponse.json({ success: true, key, value, status: getReplyAgentStatus() });
}
