import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const TOKEN_NAME = 'auth-token';

export function proxy(req: NextRequest) {
  const token = req.cookies.get(TOKEN_NAME)?.value;

  // API routes handle their own auth verification (Node.js runtime)
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // For page routes, redirect to login if no token
  if (!token && req.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // Allow public pages
  const publicPaths = ['/login'];
  if (publicPaths.includes(req.nextUrl.pathname)) return NextResponse.next();

  if (token && req.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
