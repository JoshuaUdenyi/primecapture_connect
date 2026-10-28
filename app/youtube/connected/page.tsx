export const dynamic = 'force-dynamic';
export default async function YouTubeConnected({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const { result } = await searchParams;
  const title = result === 'connected' ? 'YouTube channel connected' : result === 'cancelled' ? 'Connection cancelled' : 'Channel not connected';
  const text = result === 'connected' ? 'PrimeCapture can now prepare broadcasts for this channel. You can close this tab.' : 'Ask PrimeCapture for a fresh connection link and try again. Choose the correct channel and approve the requested permission.';
  return <main className="login-shell"><div className="login-panel"><span className="eyebrow">PRIMECAPTURE CONNECT</span><h1>{title}</h1><p className="muted">{text}</p></div></main>;
}
