import { NextRequest, NextResponse } from 'next/server';
import { applyConfigImport, createConfigExport, validateConfigImport } from '@/lib/config-transfer';
import { getAllSettings, getDb, initDB, logAudit } from '@/lib/db';
import { requireAuth, requireSameOrigin } from '@/lib/auth';
import { SCHEDULE_KEYS, validateScheduleWindow, validateSettingValue } from '@/lib/settings-validation';
import { refreshSchedule } from '@/lib/scheduler';
import { getContentPillars } from '@/lib/content-pillars';
import { getContentCompositions } from '@/lib/content-compositions';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initDB();
  const rows = getDb().prepare(
    'SELECT name, url, pillar, source_type, approved FROM sources ORDER BY created_at DESC',
  ).all() as { name: string; url: string; pillar: string; source_type: string; approved: number }[];
  const payload = createConfigExport(
    getAllSettings(),
    rows.map(row => ({ ...row, approved: Boolean(row.approved) })),
    getContentPillars(getDb()),
    new Date().toISOString(),
    getContentCompositions(getDb()),
  );

  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="threads-auto-poster-config.json"',
    },
  });
}

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });

  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: 'File konfigurasi terlalu besar' }, { status: 413 });
  }

  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'JSON konfigurasi tidak valid' }, { status: 400 });
  }
  const result = validateConfigImport(input);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });

  initDB();
  const db = getDb();
  const currentSettings = getAllSettings();
  const mergedSettings = { ...currentSettings, ...result.config.settings };
  for (const [key, value] of Object.entries(result.config.settings)) {
    const validated = validateSettingValue(key, value);
    if (validated instanceof Error) return NextResponse.json({ error: `${key}: ${validated.message}` }, { status: 400 });
  }
  for (const key of SCHEDULE_KEYS) {
    const value = mergedSettings[key];
    if (!value) continue;
    const windowError = validateScheduleWindow(key, value, mergedSettings);
    if (windowError) return NextResponse.json({ error: windowError }, { status: 400 });
  }

  const counts = applyConfigImport(db, result.config);

  refreshSchedule();
  logAudit('config_imported', `settings=${counts.settings} sources=${counts.sources}`);
  return NextResponse.json({ success: true, ...counts });
}
