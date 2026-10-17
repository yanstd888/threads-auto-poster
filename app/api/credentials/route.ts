import { NextRequest, NextResponse } from 'next/server';
import { getDb, initDB, getSetting, setSetting, logAudit } from '@/lib/db';
import { requireAuth, requireSameOrigin } from '@/lib/auth';
import { saveToken } from '@/lib/threads-api';

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initDB();
  const db = getDb();

  const credentials = db.prepare(
    'SELECT id, service, expires_at as "expires_at", updated_at FROM tokens ORDER BY updated_at DESC'
  ).all() as any[];

  return NextResponse.json({
    credentials,
    settings: {
      threads_username: getSetting('threads_username'),
    },
  });
}

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });

  initDB();
  const body = await req.json();
  const { service, token, username, expires_at } = body;

  if (!service || !token) {
    return NextResponse.json({ error: 'service and token required' }, { status: 400 });
  }

  // For Threads: validate token via Graph API
  if (service === 'threads' && username) {
    setSetting('threads_username', username);
  }

  // Validate token via Graph API if threads
  if (service === 'threads') {
    try {
      const validateRes = await fetch(
        `https://graph.threads.net/v1.0/me?access_token=${token}`,
        { method: 'GET' }
      );
      const validateData = await validateRes.json();
      if (validateData.error) {
        logAudit('token_validation_failed', validateData.error.message);
        return NextResponse.json({ error: `Token tidak valid: ${validateData.error.message}`, validation: validateData.error }, { status: 400 });
      }
      logAudit('token_validated', 'threads');
    } catch (e: any) {
      logAudit('token_validation_error', e.message);
    }
  }

  saveToken(service, token, expires_at ? Number(expires_at) : undefined);
  logAudit('token_saved', `service=${service}`);

  return NextResponse.json({ ok: true, service });
}
