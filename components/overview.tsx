'use client';

import { ArrowUpRight, Facebook, Film, Monitor, Users, Youtube, Radio } from 'lucide-react';
import type { DashboardData, Production } from '@/lib/types';
import { Badge, Empty, ProductionRow, pageAccessLabel } from './workspace-ui';

type Props = {
  data: DashboardData;
  now: number;
  onOpen: (dialog: 'production' | 'destination' | 'device' | 'guide') => void;
  onNavigate: (section: 'Productions' | 'Clients & channels' | 'Devices' | 'Audit log') => void;
  onSelectProduction: (production: Production) => void;
};

export function Overview({ data, now, onOpen, onNavigate, onSelectProduction }: Props) {
  const devices = data.agents.filter(device => !device.revoked_at);
  const online = devices.filter(device => device.last_seen_at && now - Date.parse(device.last_seen_at) < 20000);

  return <div className="overview-dashboard">
    <div className="metrics-grid">
      <div className="metric-card orange"><strong>{data.productions.length}</strong><div><Film size={19}/>Productions</div></div>
      <div className="metric-card green"><strong>{data.clients.length}</strong><div><Users size={19}/>Clients</div></div>
      <div className="metric-card purple"><strong>{data.destinations.length}</strong><div><Radio size={19}/>Channels</div></div>
    </div>

    <div className="desk-grid">
      <section className="card productions-card">
        <div className="card-head"><h2>Recent productions</h2>{data.productions.length > 3 && <button className="text-button" onClick={() => onNavigate('Productions')}>View all <ArrowUpRight size={16}/></button>}</div>
        {data.productions.length ? data.productions.slice(0, 3).map(production => <ProductionRow key={production.id} production={production} clientName={data.clients.find(client => client.id === production.client_id)?.name ?? 'Client'} onClick={() => onSelectProduction(production)}/>) : <Empty icon={<Film/>} title="No productions yet" text="Create a production to get started."/>}
      </section>

      <section className="card pages-card">
        <div className="card-head"><h2>Channel access</h2><button className="icon-button" aria-label="Manage channels" onClick={() => onNavigate('Clients & channels')}><ArrowUpRight size={19}/></button></div>
        {data.destinations.length ? data.destinations.slice(0, 3).map(page => {
          const ready = page.connection_status === 'publish_ready' && page.publish_capable;
          const label = pageAccessLabel(page);
          return <div className="destination-row" key={page.id}><span className="facebook-icon">{page.provider === 'youtube' ? <Youtube size={20}/> : <Facebook size={20}/>}</span><div className="row-main"><strong>{page.display_name}</strong><small>{page.provider === 'youtube' ? 'Channel' : 'Page ID'} {page.external_id}</small><Badge tone={ready ? 'green' : ['revoked', 'expired'].includes(page.connection_status) ? 'neutral' : 'amber'}>{label}</Badge></div></div>;
        }) : <Empty icon={<Facebook/>} title="No destinations added" text="Connect YouTube or add a Facebook Page."/>}
        {data.destinations.length > 3 && <button className="card-link" onClick={() => onNavigate('Clients & channels')}>View all destinations <ArrowUpRight size={16}/></button>}
      </section>
    </div>

    <section className="card device-summary">
      <div className="device-summary-heading"><span className="device-icon"><Monitor size={25}/></span><div><h2>Production devices</h2><p>{devices.length ? `${online.length} online · ${devices.length} paired` : 'No production PC paired yet.'}</p></div></div>
      {devices.length > 0 && <div className="device-summary-list">{devices.slice(0, 2).map(device => <div key={device.id}><strong>{device.name}</strong><span>{!online.some(item => item.id === device.id) ? 'Offline' : !device.obs_connected ? 'OBS disconnected' : device.output_active ? 'OBS live · protected' : 'OBS idle'}</span></div>)}</div>}
      <button className="button secondary" onClick={() => devices.length || data.staff.role !== 'admin' ? onNavigate('Devices') : onOpen('device')}>{devices.length || data.staff.role !== 'admin' ? 'Manage devices' : 'Pair a device'}<ArrowUpRight size={17}/></button>
    </section>
  </div>;
}
