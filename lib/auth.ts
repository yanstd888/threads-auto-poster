import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import { getDb, initDB, logAudit } from './db';

const TOKEN_NAME = 'auth-token';

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET belum diset. Isi di .env.local sebelum menjalankan server.');
  return secret;
}

export function requireSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    const allowed = [process.env.NEXTAUTH_URL, process.env.APP_PUBLIC_URL].filter(Boolean).map(value => new URL(value as string).origin);
    return origin === req.nextUrl.origin || allowed.includes(origin);
  } catch {
    return false;
  }
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 12);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function createToken(adminId = '1'): string {
  return jwt.sign({ sub: adminId, role: 'admin' }, jwtSecret(), { expiresIn: '8h' });
}

export function verifyToken(token: string): { sub: string; role: 'admin' } | null {
  try {
    const payload = jwt.verify(token, jwtSecret()) as { sub?: string; role?: string };
    return payload.sub && payload.role === 'admin' ? { sub: payload.sub, role: 'admin' } : null;
  } catch {
    return null;
  }
}

export function requireAuth(req: NextRequest) {
  const token = req.cookies.get(TOKEN_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export function setAuthCookie(token: string, response: NextResponse) {
  response.cookies.set(TOKEN_NAME, token, { httpOnly: true, path: '/', maxAge: 60 * 60 * 8, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
}

export function initDefaultUser() {
  initDB();
  const db = getDb();
  const existing = db.prepare('SELECT id FROM admin_credentials WHERE id = 1').get() as { id: number } | undefined;
  if (existing) return;
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 16) throw new Error('ADMIN_PASSWORD wajib ada di env, password minimal 16 karakter.');
  db.prepare('INSERT INTO admin_credentials (id, password_hash) VALUES (1, ?)').run(hashPassword(password));
  logAudit('admin_credential_initialized', 'single admin password initialized');
}