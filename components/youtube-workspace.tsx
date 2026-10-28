'use client';
import { useState, type FormEvent } from 'react';
import { ArrowUpRight, Copy, Youtube, ShieldCheck } from 'lucide-react';
import type { Client, Destination, Production, YouTubeBroadcast } from '@/lib/types';
async function post(path: string, body: unknown = {}) {
  const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The YouTube request could not be completed.');
  return result;
}
export function YouTubeConnection({ clients }: { clients: Client[] }) {
  const [client, setClient] = useState(clients[0]?.id || ''), [link, setLink] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try { const result = await post('youtube/connect', { client_id: client }); setLink(result.connect_url); }
    catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  return <form onSubmit={create}><p className="muted modal-intro">Send the client a Google authorization link. They choose their YouTube channel and grant PrimeCapture access to create broadcasts.</p><label htmlFor="youtube-client">Client</label><select id="youtube-client" value={client} onChange={event => { setClient(event.target.value); setLink(''); setMessage(''); }} required><option value="" disabled>Choose a client</option>{clients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{!clients.length && <p className="notice">Add a client first.</p>}
    {!link ? <button className="button primary full" disabled={busy || !client}><Youtube size={18}/>{busy ? 'Creating link…' : 'Create connection link'}</button> : <><label htmlFor="youtube-link">Client connection link</label><input id="youtube-link" value={link} readOnly onFocus={event => event.target.select()}/><small className="field-help">One use. Expires in 24 hours. Share it only with this client. The client must be able to reach the app’s address.</small><div className="youtube-actions"><button type="button" className="button secondary" onClick={() => void navigator.clipboard.writeText(link).then(() => setMessage('Link copied.')).catch(() => setMessage('Select the link above and copy it manually.'))}><Copy size={17}/>Copy link</button><a className="button primary" href={link} target="_blank" rel="noopener noreferrer">Open connection <ArrowUpRight size={17}/></a></div></>}
    {message && <p className="notice" role="status">{message}</p>}
  </form>;
}
export function YouTubePreflight({ production, destination, broadcast, demo, onChange }: { production: Production; destination: Destination; broadcast?: YouTubeBroadcast; demo: boolean; onChange: () => Promise<void> }) {
  const [prepared, setPrepared] = useState<YouTubeBroadcast | undefined>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [remote, setRemote] = useState<{ state: string; privacy: string; checked_at: string }>();
  const current = broadcast || prepared;
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const fields = new FormData(event.currentTarget);
    try {
      const value = await post(`productions/${production.id}/prepare`, { scheduled_start_at: new Date(String(fields.get('start'))).toISOString(), privacy: fields.get('privacy'), made_for_kids: fields.get('audience') === 'yes', confirmed: fields.get('confirm') === 'on' });
      setPrepared(value); await onChange();
    } catch (e) { setError((e as Error).message); await onChange(); }
    finally { setBusy(false); }
  }
  async function status() {
    setBusy(true); setError('');
    try { setRemote(await post(`productions/${production.id}/youtube-status`)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const [localDate] = useState(() => {
    const date = new Date(Date.now() + 15 * 60000); date.setSeconds(0, 0);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const remoteLabels: Record<string, string> = { created: 'Scheduled', ready: 'Ready to go live', testing: 'Receiving a test stream', testStarting: 'Starting test', liveStarting: 'Starting broadcast', live: 'Live on YouTube', complete: 'Broadcast ended', revoked: 'Broadcast revoked' };
  return <div><span className="eyebrow">YOUTUBE BROADCAST</span><h3 className="production-title">{production.title}</h3><div className="youtube-channel-label"><Youtube size={20}/><div><strong>{destination.display_name}</strong><small>{destination.external_id}</small></div></div>
    {demo && <p className="notice">Sample channel. Real YouTube API requests are disabled in this simulation.</p>}
    {current ? <><div className="notice"><ShieldCheck size={20}/><span>{current.status === 'READY' ? 'The YouTube API created and bound this broadcast. Go-live remains a separate operator action.' : 'This request needs review in YouTube Studio. It will not be retried automatically.'}</span></div><p className="muted">{current.privacy} · {new Date(current.scheduled_start_at).toLocaleString()}</p><div className="youtube-actions"><a className="button primary" href={current.youtube_broadcast_id ? `https://studio.youtube.com/video/${encodeURIComponent(current.youtube_broadcast_id)}/livestreaming` : 'https://studio.youtube.com'} target="_blank" rel="noopener noreferrer">Open YouTube Studio <ArrowUpRight size={17}/></a>{current.youtube_broadcast_id && <button className="button secondary" disabled={busy} onClick={() => void status()}>{busy ? 'Checking…' : 'Check YouTube status'}</button>}</div>
      {remote && <p className="notice" role="status">{remoteLabels[remote.state] || 'Status unavailable'} · {remote.privacy} · Checked {new Date(remote.checked_at).toLocaleTimeString()}</p>}
      {current.status === 'READY' && <p className="field-help">In YouTube Studio, copy this broadcast’s encoder settings to an idle OBS instance. Verify the preview, then choose Go live in Studio. Keep any existing broadcast untouched.</p>}
    </> : <form onSubmit={create}>
      <label htmlFor="youtube-start">Start time (your local time)</label><input id="youtube-start" name="start" type="datetime-local" defaultValue={localDate} required/>
      <label htmlFor="youtube-privacy">Visibility</label><select id="youtube-privacy" name="privacy" defaultValue="private"><option value="private">Private — recommended for the first test</option><option value="unlisted">Unlisted — anyone with the link</option><option value="public">Public</option></select>
      <label htmlFor="youtube-audience">Is this broadcast made for children?</label><select id="youtube-audience" name="audience" defaultValue="" required><option value="" disabled>Choose the correct audience</option><option value="no">No, it is not made for children</option><option value="yes">Yes, it is made for children</option></select>
      <label className="confirmation"><input type="checkbox" name="confirm" required/><span>Create this broadcast on {destination.display_name} with the selected visibility and audience.</span></label>
      <p className="field-help">Creates the scheduled broadcast and its encoder stream through the YouTube API. Auto-start and auto-stop stay off. OBS remains under operator control.</p>
      <button className="button primary full" disabled={busy || ['revoked','expired'].includes(destination.connection_status)}><Youtube size={18}/>{busy ? 'Creating on YouTube…' : 'Create YouTube broadcast'}</button>
    </form>}
    {error && <p className="error-banner" role="alert">{error}</p>}
  </div>;
}
