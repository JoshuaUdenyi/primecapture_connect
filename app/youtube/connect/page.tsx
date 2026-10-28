import { YouTubeConsent } from '@/components/youtube-consent';
import { hash } from '@/lib/security/crypto';
import { invitation } from '@/lib/youtube/store';
import { isDemo } from '@/lib/config';
export const dynamic = 'force-dynamic';
export default async function ConnectYouTube({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const invite = (await searchParams).invite;
  let details: { clientName: string } | null = null;
  if (!isDemo() && typeof invite === 'string' && /^[A-Za-z0-9_-]{43}$/.test(invite)) {
    try { details = await invitation(hash(invite)); } catch { /* A public page must not expose database or credential errors. */ }
  }
  if (!details || !invite) return <main className="login-shell"><div className="login-panel"><h1>Connection link unavailable</h1><p className="muted">Ask PrimeCapture for a new YouTube connection link.</p></div></main>;
  return <YouTubeConsent invite={invite} clientName={details.clientName}/>;
}
