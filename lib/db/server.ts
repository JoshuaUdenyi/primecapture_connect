import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { ApiError } from '@/lib/security/errors';
export function adminDb() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new ApiError(503, 'SETUP_REQUIRED', 'Supabase setup is required.');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function authClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) throw new ApiError(503, 'SETUP_REQUIRED', 'Supabase setup is required.');
  const jar = await cookies();
  return createServerClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { cookies: {
    getAll: () => jar.getAll(),
    setAll: (values) => { for (const { name, value, options } of values) jar.set(name, value, { ...options, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' }); },
  } });
}
