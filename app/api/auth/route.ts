import { NextRequest, NextResponse } from 'next/server';
import { getDb, initDB, logAudit } from '@/lib/db';
import { initDefaultUser, verifyPassword, createToken, requireSameOrigin, setAuthCookie } from '@/lib/auth';

// ponytail: process-local limiter; move to Redis only when this runs multi-instance.
const attempts = new Map<string, { count: number; first: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (now - rec.first > WINDOW_MS) { attempts.delete(ip); return false; }
  return rec.count >= MAX_ATTEMPTS;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) attempts.set(ip, { count: 1, first: now });
  else rec.count++;
}

export async function POST(req: NextRequest) {
  try {
    if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });
    initDB();
    initDefaultUser();
    const body = await req.json();
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!password || password.length > 1024) return NextResponse.json({ error: 'Kredensial tidak valid' }, { status: 401 });
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
    if (isRateLimited(ip)) { logAudit('login_rate_limited', `ip=${ip}`); return NextResponse.json({ error: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' }, { status: 429 }); }
    const db = getDb();
    const admin = db.prepare('SELECT id, password_hash FROM admin_credentials WHERE id = 1').get() as { id: number; password_hash: string } | undefined;
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      recordFailure(ip);
      logAudit('login_failed', `ip=${ip}`);
      return NextResponse.json({ error: 'Kredensial tidak valid' }, { status: 401 });
    }
    attempts.delete(ip);
    const response = NextResponse.json({ success: true });
    setAuthCookie(createToken(String(admin.id)), response);
    logAudit('login', 'single admin login');
    return response;
  } catch (error) {
    logAudit('login_error', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Login sementara tidak tersedia' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, version: '1.0.0' });
}