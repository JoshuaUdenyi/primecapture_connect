import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { Dashboard } from '@/components/dashboard';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const jar = await cookies();
  if (!jar.has('pc-demo') && !jar.getAll().some(c => c.name.startsWith('sb-'))) redirect('/login');
  // All data and actions still require authoritative server-side authorization.
  return <Dashboard />;
}
