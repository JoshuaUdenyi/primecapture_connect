'use client';
import { useState } from 'react';
import { Youtube } from 'lucide-react';
export function YouTubeConsent({ invite, clientName }: { invite: string; clientName: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function connect() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/youtube/authorize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invite }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      window.location.assign(result.authorization_url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Connection could not be started.'); setBusy(false); }
  }
  return <main className="login-shell"><div className="login-panel"><div className="login-card"><span className="eyebrow">PRIMECAPTURE CONNECT</span><h1>Connect YouTube</h1><p>Authorize your channel for {clientName}.</p><div className="notice"><Youtube size={22}/><span>PrimeCapture will be able to create and manage YouTube broadcasts on the channel you choose. Review the permission on Google’s next screen.</span></div><p className="muted">Choose the correct channel or Brand Account. You can remove access later in your Google Account.</p><button className="button primary full" disabled={busy} onClick={() => void connect()}>{busy ? 'Opening Google…' : 'Continue with Google'}</button>{error && <p className="error-banner" role="alert">{error}</p>}</div></div></main>;
}
