import 'server-only';
import { cookies } from 'next/headers';
import { isDemo, assertRuntimeSafety } from '@/lib/config';
import { demo } from '@/lib/db/demo';
import { adminDb, authClient } from '@/lib/db/server';
import { ApiError } from '@/lib/security/errors';
import type { Role, Staff } from '@/lib/types';
export function requireRole(staff: Staff, roles: Role[]) {
  if (!staff.is_active) throw new ApiError(403, 'STAFF_DISABLED', 'Staff access is disabled.');
  if (!roles.includes(staff.role)) throw new ApiError(403, 'FORBIDDEN', 'Administrator access is required.');
  return staff;
}
export async function requireStaff(roles: Role[] = ['admin', 'operator']): Promise<Staff> {
  assertRuntimeSafety();
  if (isDemo()) {
    const session = demo.sessions.get((await cookies()).get('pc-demo')?.value ?? '');
    if (!session) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    return requireRole(session, roles);
  }
  // No cookie means unauthenticated, including an unconfigured deployment.
  if (!(await cookies()).getAll().some(c => c.name.startsWith('sb-'))) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
  const { data: { user }, error } = await (await authClient()).auth.getUser();
  if (error || !user) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
  const { data, error: dbError } = await adminDb().from('staff_profiles').select('user_id,email,role,is_active').eq('user_id', user.id).single();
  if (dbError || !data || !['admin', 'operator'].includes(data.role)) throw new ApiError(403, 'STAFF_ONLY', 'This account is not approved for staff access.');
  return requireRole(data as Staff, roles);
}
