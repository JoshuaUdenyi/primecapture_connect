'use client';
import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Aperture, ArrowRight, ShieldCheck, Radio, LockKeyhole } from 'lucide-react';
const subscribe = () => () => {};
export function SignIn({ demo, configured }: { demo: boolean; configured: boolean }) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const [email, setEmail] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function login(simulate = false) {
    setBusy(true); setMessage('');
    try {
      const res = await fetch(simulate ? '/api/auth/demo' : '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(simulate ? { role: 'admin' } : { email }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      if (simulate) router.push('/'); else setMessage(data.message);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to sign in. Try again.'); }
    finally { setBusy(false); }
  }
  return <main className="login-shell">
    <section className="login-brand"><Link className="brand" href="/login"><span className="brand-symbol"><Aperture /></span><span>primecapture<span className="brand-sub">CONNECT</span></span></Link>
      <div className="login-copy"><span className="eyebrow">THE PRIME CAPTURE CONTROL ROOM</span><h1>Great moments.<br/><em>Connected safely.</em></h1><p>Bring your clients, destinations, and production crew together. Keep the focus on the moment.</p><div className="signal-art"><Radio size={76} strokeWidth={1}/><span/><span/><span/></div></div>
      <small><ShieldCheck size={16}/> Built for the crew. Designed to protect the broadcast.</small>
    </section>
    <section className="login-panel"><div className="login-card"><span className="icon-tile"><LockKeyhole size={22}/></span><h2>Welcome to the control room</h2><p className="muted">Sign in with your approved PrimeCapture staff email. No shared passwords. No public registration.</p>
      <form onSubmit={e => { e.preventDefault(); void login(); }}><label htmlFor="email">Work email</label><input id="email" type="email" autoComplete="email" placeholder="you@primecapture.media" required value={email} onChange={e => setEmail(e.target.value)}/><button className="button primary full" disabled={!hydrated || busy || !configured}>Send secure sign-in link <ArrowRight size={17}/></button></form>
      {!configured && <p className="notice">Staff sign-in awaits Supabase configuration. Publishing remains disabled.</p>}
      {demo && <div className="demo-login"><span className="eyebrow">LOCAL DEVELOPMENT</span><p>Explore with labelled sample records. This simulation cannot publish to Facebook or control OBS.</p><button className="button secondary full" disabled={!hydrated || busy} onClick={() => void login(true)}>Enter local simulation <ArrowRight size={17}/></button></div>}
      {message && <p className="notice" role="status">{message}</p>}<small className="login-foot">Authorized crew only · Access is recorded</small>
    </div></section>
  </main>;
}
