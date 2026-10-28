'use client';
import { useCallback, useEffect, useRef, useState, useId, type FormEvent, type ReactNode } from 'react';
import { Aperture, ArrowRight, ArrowUpRight, Check, CheckCheck, CircleHelp, Youtube, ClipboardList, Copy, Facebook, Film, LayoutDashboard, LoaderCircle, LogOut, Menu, Monitor, Plus, Search, ShieldCheck, ShieldAlert, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { DashboardData, Production } from '@/lib/types';
import { YouTubeConnection, YouTubePreflight } from '@/components/youtube-workspace';
import { Overview } from '@/components/overview';
import { Badge, Empty, ProductionRow, pageAccessLabel } from '@/components/workspace-ui';
type Section = 'Overview' | 'Productions' | 'Clients & channels' | 'Devices' | 'Audit log';
type Dialog = 'production' | 'client' | 'destination' | 'device' | 'guide' | 'youtube' | null;
const navigation = [{ title: 'Overview', icon: LayoutDashboard }, { title: 'Productions', icon: Film }, { title: 'Clients & channels', icon: Users }, { title: 'Devices', icon: Monitor }, { title: 'Audit log', icon: ClipboardList }] as const;
export function Dashboard() {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !(target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select')))) {event.preventDefault();searchRef.current?.focus();}
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);
  const [now, setNow] = useState(0);
  const [data, setData] = useState<DashboardData | null>(null);
  const [section, setSection] = useState<Section>('Overview'); const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null); const [selected, setSelected] = useState<Production | null>(null);
  const [error, setError] = useState(''); const [toast, setToast] = useState(''); const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false); const [pairCode, setPairCode] = useState<{code: string; expires_at: string} | null>(null);
  const [formClient, setFormClient] = useState('');
  const load = useCallback(async () => {
    try { const res = await fetch('/api/dashboard', { cache: 'no-store' }); if (res.status === 401) { router.push('/login'); return; } const value = await res.json(); if (!res.ok) throw new Error(value.error); setData(value); setNow(Date.now()); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load the control room.'); }
  }, [router]);
  useEffect(() => { const initial = setTimeout(() => void load(), 0); const timer = setInterval(() => void load(), 15000); return () => {clearTimeout(initial);clearInterval(timer);}; }, [load]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); } }, [toast]);
  async function post(path: string, payload: unknown = {}) {
    const res = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const value = await res.json(); if (!res.ok) throw new Error(value.error); return value;
  }
  function open(value: Dialog) { setMenu(false); setError(''); setPairCode(null); setFormClient(data?.clients[0]?.id ?? ''); setDialog(value); }
  function navigate(value: Section) { setSection(value); setQuery(''); setMenu(false); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (dialog === 'device') { const result = await post('agents/pair-code', fields); setPairCode(result); return; }
      const path = dialog === 'client' ? 'clients' : dialog === 'destination' ? 'destinations' : 'productions';
      if (path === 'productions' && !fields.destination_id) delete fields.destination_id;
      await post(path, fields); setDialog(null); setToast(path === 'clients' ? 'Client added.' : path === 'destinations' ? 'Page saved. Access still needs verification.' : 'Production saved.'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Try again.'); }
    finally { setBusy(false); }
  }
  const clients = data?.clients.filter(c => c.name.toLowerCase().includes(query.toLowerCase())) ?? [];
  const productions = data?.productions.filter(p => p.title.toLowerCase().includes(query.toLowerCase())) ?? [];
  const devices = data?.agents.filter(a => !a.revoked_at) ?? [];
  const online = devices.filter(a => a.last_seen_at && now - Date.parse(a.last_seen_at) < 20000);
  const title = section === 'Overview' ? 'Dashboard' : section;
  return <div className="app-shell">
    {menu && <div className="nav-backdrop" onClick={() => setMenu(false)}/>}
    <aside className={'sidebar ' + (menu ? 'visible' : '')}>
      <Link className="brand" href="/"><span className="brand-symbol"><Aperture size={25}/></span><span>primecapture<span className="brand-sub">CONNECT</span></span></Link>
      <nav aria-label="Main navigation">{navigation.filter(item => item.title !== 'Audit log' || data?.staff.role === 'admin').map(({title: item, icon: Icon}) => <button key={item} onClick={() => navigate(item)} className={section === item ? 'nav-item active' : 'nav-item'} aria-current={section === item ? 'page' : undefined}><Icon size={19}/>{item === 'Overview' ? 'Dashboard' : item}{item === 'Productions' && <span className="nav-count">{data?.productions.length ?? 0}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => open('guide')}><CircleHelp size={20}/>Help</button></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="mobile-toggle" aria-label="Open navigation" onClick={() => setMenu(true)}><Menu size={21}/></button><strong>PrimeCapture Media</strong></div><div className="header-search"><Search size={15}/><input ref={searchRef} aria-keyshortcuts="/" aria-label="Search productions" placeholder="Search productions…" value={section === 'Productions' ? query : ''} onChange={event => {setSection('Productions');setQuery(event.target.value);}}/><kbd>/</kbd></div><div className="topbar-right"><span className="staff-role">{data?.staff.role === 'admin' ? 'Administrator' : 'Operator'}</span><span className="avatar">{data?.staff.email.slice(0,2).toUpperCase() ?? 'PC'}</span><button className="signout-button" aria-label="Sign out" onClick={async () => {try {await post('auth/logout');router.push('/login');} catch {setToast('Could not sign out. Try again.');}}}><LogOut size={20}/></button></div></header>
      {data?.demo && <div className="simulation-bar"><span><ShieldAlert size={15}/><strong>SIMULATED WORKSPACE</strong><span>Sample data · Publishing disabled</span></span></div>}
      <main className="content"><div className="page-heading"><h1>{title}</h1>{section !== 'Audit log' && <button className="button primary" onClick={() => open(section === 'Clients & channels' ? 'client' : section === 'Devices' ? 'device' : 'production')} disabled={section === 'Devices' && data?.staff.role !== 'admin'}><Plus size={17}/>{section === 'Clients & channels' ? 'Add client' : section === 'Devices' ? 'Pair a device' : 'New production'}</button>}</div>
      {!data && !error && <div className="loading"><LoaderCircle className="spin"/>Loading…</div>}
      {error && !dialog && !selected && <div className="error-banner" role="alert">{error}<button className="text-button" onClick={() => void load()}>Retry</button></div>}
      {data && <>
      {section === 'Overview' && <Overview data={data} now={now} onOpen={open} onNavigate={navigate} onSelectProduction={production => {setError('');setSelected(production);}}/>}
      {section === 'Productions' && <section className="card">{productions.map(p => <ProductionRow key={p.id} production={p} clientName={data.clients.find(c => c.id === p.client_id)?.name ?? 'Client'} onClick={() => {setError('');setSelected(p);}}/>)}{!productions.length && <Empty icon={<Film/>} title="No productions found" text="Create a production to get started."/>}</section>}
      {section === 'Clients & channels' && <><div className="section-toolbar"><h2>Your clients <span className="count-bubble">{data.clients.length}</span></h2><SearchBox value={query} setValue={setQuery} placeholder="Find a client"/>{data.staff.role === 'admin' && <button className="button secondary" onClick={() => open('youtube')}><Youtube size={18}/>Connect YouTube</button>}<button className="button secondary" onClick={() => open('destination')}><Plus size={16}/>Add Page reference</button></div><div className="client-grid">{clients.map(c => <section className="card client-card" key={c.id}><span className="client-avatar">{c.name.slice(0,1)}</span><h2>{c.name}</h2>{c.notes && <p>{c.notes}</p>}<div className="client-pages">{data.destinations.filter(d => d.client_id === c.id).map(d => <div key={d.id}>{d.provider === 'youtube' ? <Youtube size={18}/> : <Facebook size={17}/>}<span><strong>{d.display_name}</strong><small>{d.external_id} · {pageAccessLabel(d)}</small></span>{d.connection_status !== 'revoked' && data.staff.role === 'admin' && <button className="text-button" aria-label={'Disconnect ' + d.display_name} onClick={async () => {if(!window.confirm('Remove local access? The owner can also revoke access in their platform account settings. Existing broadcasts keep running.')) return;try{const result=await post(`destinations/${d.id}/disconnect`);setToast(result.message);await load();}catch(e){setError((e as Error).message);}}}>Disconnect</button>}</div>)}{!data.destinations.some(d => d.client_id === c.id) && <small>No destinations connected.</small>}</div></section>)}</div>{!clients.length && <Empty icon={<Users/>} title="No clients found" text="Add a client to get started."/>}<p className="inline-note"><ShieldAlert size={16}/>Page references do not grant publishing access.</p></>}
      {section === 'Devices' && <><div className="notice"><ShieldCheck size={18}/><span>Devices report OBS status. Remote stream control is unavailable.</span></div><div className="client-grid">{data.agents.map(a => <section className="card client-card" key={a.id}><span className="icon-tile"><Monitor size={25}/></span><h2>{a.name}</h2><Badge tone={a.revoked_at ? 'neutral' : online.some(o => o.id === a.id) ? 'green' : 'neutral'}>{a.revoked_at ? 'Revoked' : online.some(o => o.id === a.id) ? 'Online' : 'Offline'}</Badge><p>{a.obs_connected ? a.output_active ? 'OBS is live. The existing broadcast is protected.' : 'OBS connected and idle.' : 'OBS is not connected.'}</p><small>Last heartbeat: {a.last_seen_at ? new Date(a.last_seen_at).toLocaleString() : 'Not received'}</small>{!a.revoked_at && data.staff.role === 'admin' && <button className="button secondary" onClick={async () => { if (!window.confirm('Revoke this device? This will not stop its existing OBS broadcast.')) return; try { await post(`agents/${a.id}/revoke`); await load(); setToast('Device revoked. Existing broadcasts were not changed.'); } catch(e) { setError((e as Error).message); } }}>Revoke device</button>}</section>)}</div>{!data.agents.length && <section className="card"><Empty icon={<Monitor/>} title="Bring your production PC into view" text="Run the local helper on your production PC, then pair it here."/></section>}</>}
      {section === 'Audit log' && <section className="card"><div className="card-head"><div><h2>Workspace activity</h2><p>Latest 200 events</p></div><ShieldCheck size={22}/></div>{data.staff.role !== 'admin' ? <Empty icon={<ShieldAlert/>} title="Administrator access required" text="Only workspace administrators can read the security audit log."/> : data.audit.map(a => <div className="audit-row" key={a.id}><span className="audit-dot"/><div><strong>{a.action.replaceAll('.',' · ').replaceAll('_',' ')}</strong><small>Actor {a.actor_user_id.slice(0,8)} · {a.resource_id ? 'Record ' + a.resource_id.slice(0,8) : 'Workspace'}</small></div><time dateTime={a.created_at}>{new Date(a.created_at).toLocaleString()}</time></div>)}</section>}
      </>}
      </main>
    </div>
    {toast && <div className="toast" role="status"><CheckCheck size={18}/>{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={15}/></button></div>}
    {dialog && <Modal title={dialog === 'production' ? 'Create a production' : dialog === 'client' ? 'Add a client' : dialog === 'destination' ? 'Add a Page reference' : dialog === 'device' ? 'Pair your production PC' : dialog === 'youtube' ? 'Connect a client’s YouTube channel' : 'Broadcast safety'} onClose={() => {setDialog(null);setError('');}}>
      {dialog === 'guide' ? <SafetyGuide/> : dialog === 'youtube' ? <YouTubeConnection clients={data?.clients || []}/> : <form onSubmit={submit}>
        <p className="muted modal-intro">{dialog === 'production' ? 'Save the production details, then review its preflight checks.' : dialog === 'destination' ? 'Save a Page reference. Publishing access must be verified separately.' : dialog === 'device' ? 'Generate a one-time code, then enter it into the Node helper on your production PC. It expires in five minutes.' : 'Keep a client’s productions and Page references together.'}</p>
        {dialog === 'device' && pairCode ? <div className="pair-code"><span className="eyebrow">ONE-TIME PAIRING CODE</span><code>{pairCode.code}</code><button type="button" className="button secondary" onClick={() => { void navigator.clipboard.writeText(pairCode.code).then(() => setToast('Pairing code copied. Share only with the production PC operator.')).catch(() => setToast('Copy unavailable. Enter the displayed code manually.')); }}><Copy size={16}/>Copy code</button><small>Expires {new Date(pairCode.expires_at).toLocaleTimeString()} · One use only</small><p>Run <code>npm run agent -- --pair</code> on your PC and enter this code when prompted. Status only; stream control is disabled.</p></div> : <>
        {(dialog === 'production' || dialog === 'destination') && <><label htmlFor="client_id">Client</label><select id="client_id" name="client_id" value={formClient} onChange={e => setFormClient(e.target.value)} required><option value="" disabled>Select a client</option>{data?.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{!data?.clients.length && <p className="notice">Add a client first.</p>}</>}
        <label htmlFor="record-name">{dialog === 'production' ? 'Production title' : dialog === 'destination' ? 'Page display name (unverified)' : dialog === 'device' ? 'Device name' : 'Client name'}</label><input id="record-name" name={dialog === 'production' ? 'title' : dialog === 'destination' ? 'display_name' : 'name'} placeholder={dialog === 'production' ? 'e.g. Wedding ceremony — main feed' : dialog === 'device' ? 'e.g. Production PC 01' : dialog === 'destination' ? 'e.g. Client’s Facebook Page' : 'e.g. Grace & Daniel'} required minLength={2} maxLength={120}/>
        {dialog === 'client' && <><label htmlFor="notes">Production notes <span className="muted">(optional)</span></label><textarea id="notes" name="notes" placeholder="Useful details for the crew. Never add passwords or stream keys." maxLength={1000} rows={3}/></>}
        {dialog === 'destination' && <><label htmlFor="reference">Numeric Page ID or Facebook Page ID URL</label><input id="reference" name="reference" placeholder="e.g. 100000000000001" required maxLength={500}/><small className="field-help">Find the numeric ID in Page transparency. Usernames alone cannot verify identity.</small></>}
        {dialog === 'production' && <><label htmlFor="destination_id">Stream destination <span className="muted">(optional)</span></label><select id="destination_id" name="destination_id"><option value="">Choose later</option>{data?.destinations.filter(d => d.client_id === formClient).map(d => <option value={d.id} key={d.id}>{d.provider === 'youtube' ? 'YouTube' : 'Facebook'} · {d.display_name} · {d.external_id}</option>)}</select><div className="notice"><ShieldCheck size={18}/>Saving a production never starts OBS or creates a livestream.</div></>}
        <button className="button primary full" disabled={busy || ((dialog === 'production' || dialog === 'destination') && !formClient)}>{busy ? <LoaderCircle size={17} className="spin"/> : <Plus size={17}/>} {dialog === 'production' ? 'Create production' : dialog === 'device' ? 'Generate pairing code' : dialog === 'destination' ? 'Save Page reference' : 'Add client'}</button></>}
        {error && <p className="error-banner" role="alert">{error}</p>}
      </form>}
    </Modal>}
    {selected && data && data.destinations.find(d => d.id === selected.destination_id)?.provider === 'youtube' && <Modal title="YouTube broadcast" onClose={() => {setSelected(null);setError('');}}><YouTubePreflight production={selected} destination={data.destinations.find(d => d.id === selected.destination_id)!} broadcast={data.youtube.broadcasts.find(b => b.production_id === selected.id)} demo={data.demo} onChange={load}/></Modal>}
    {selected && data && data.destinations.find(d => d.id === selected.destination_id)?.provider !== 'youtube' && <Modal title="Production preflight" onClose={() => {setSelected(null);setError('');}}><span className="eyebrow">DRAFT · NOTHING IS LIVE</span><h3 className="production-title">{selected.title}</h3><p className="muted">{data.clients.find(c => c.id === selected.client_id)?.name}</p><div className="preflight-list">{[
      [true, 'Production details saved', 'Your title and client are recorded.'],
      [Boolean(selected.destination_id), 'Choose the correct Page', selected.destination_id ? `${data.destinations.find(d => d.id === selected.destination_id)?.display_name} · ID ${data.destinations.find(d => d.id === selected.destination_id)?.external_id} (unverified)` : 'No Page reference selected. Create a new production with the correct Page.'],
      [false, 'Verify Meta publishing permission', 'BLOCKED — permissions, token health and Page tasks are unverified.'],
      [online.some(a => a.obs_connected), 'Connect a production device', online.some(a => a.obs_connected) ? 'A device reports OBS connected. Control remains disabled.' : 'Pair the helper and connect to OBS locally.'],
      [false, 'Operator confirmation', 'Stream start is disabled until all release gates pass.'],
    ].map(([ok,label,description]) => <div key={String(label)}><span className={'check-icon ' + (ok ? 'passed' : '')}>{ok ? <Check size={14}/> : <span/>}</span><span><strong>{label}</strong><small>{description}</small></span></div>)}</div><div className="notice"><ShieldAlert size={18}/>Facebook publishing is not enabled.</div><button className="button primary full" disabled={busy} onClick={async () => {setBusy(true);try {await post(`productions/${selected.id}/prepare`);} catch(e) {setError((e as Error).message);} finally {setBusy(false);}}}>Check publishing availability <ArrowRight size={16}/></button>{error && <p className="error-banner" role="alert">{error}</p>}<button className="button secondary full" onClick={() => {setSelected(null);open('guide');}}>Open manual handoff checklist <ArrowUpRight size={15}/></button></Modal>}
  </div>;
}
function SearchBox({ value, setValue, placeholder }: { value: string; setValue: (value: string) => void; placeholder: string }) {return <div className="search-box"><Search size={17}/><input aria-label={placeholder} placeholder={placeholder} value={value} onChange={e => setValue(e.target.value)}/></div>;}
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className="modal" onCancel={onClose} onClick={e => { if(e.target === e.currentTarget) onClose(); }}><div className="modal-head"><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20}/></button></div><div className="modal-body">{children}</div></dialog>;
}
function SafetyGuide() { return <div className="guide"><p className="muted">Use these checks when preparing a manual broadcast.</p><ol><li><strong>Confirm client consent and Page identity.</strong><p>The Page owner uses their own Meta account. Never request a password, cookie, or 2FA code. Confirm the numeric Page ID.</p></li><li><strong>Check whether OBS is already live.</strong><p>If it is, leave its destination, scenes, audio, recording, and stream state untouched. Do not stop it to add a Page.</p></li><li><strong>Use the owner’s supported Live Producer workflow.</strong><p>Only the authorized operator handles encoder credentials privately on the production PC. Never paste stream keys into client notes.</p></li><li><strong>Prepare an idle encoder deliberately.</strong><p>Save its current settings locally. Verify the destination, Page and feed. The operator must explicitly approve any start.</p></li><li><strong>Verify the actual broadcast.</strong><p>An OBS start acknowledgement is not proof of Facebook Live. Check the permitted viewer page with the Page owner.</p></li></ol><div className="notice"><ShieldCheck size={20}/>Production gate: complete the Meta feasibility checklist and real OBS safety rehearsal before enabling automated control.</div></div>;}
