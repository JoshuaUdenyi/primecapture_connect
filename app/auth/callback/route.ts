import { NextResponse } from 'next/server';
import { authClient } from '@/lib/db/server';
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get('code');
  const base = process.env.APP_BASE_URL;
  if (!base) return NextResponse.json({ error: 'Sign-in configuration required.' }, { status: 503 });
  if (code && code.length <= 2048) {
    const { error } = await (await authClient()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL('/', base));
  }
  return NextResponse.redirect(new URL('/login?error=expired', base));
}
