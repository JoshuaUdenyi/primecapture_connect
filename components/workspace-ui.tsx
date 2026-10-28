'use client';
import type { ReactNode } from 'react';
import { Plus, Video, ChevronRight } from 'lucide-react';
import type { Production, Destination } from '@/lib/types';

export function Badge({ children, tone = 'amber' }: { children: ReactNode; tone?: 'amber' | 'green' | 'neutral' }) {return <span className={'badge ' + tone}><span/>{children}</span>;}
export function ProductionRow({ production, clientName, onClick }: { production: Production; clientName: string; onClick: () => void }) {return <button className="production-row" onClick={onClick}><span className="production-icon"><Video size={21}/></span><span className="row-main"><strong>{production.title}</strong><small>{clientName}</small></span><Badge tone={production.status === 'BROADCAST_PREPARED' ? 'green' : 'neutral'}>{production.status === 'BROADCAST_PREPARED' ? 'Prepared' : production.status === 'ACCESS_PENDING' ? 'Access pending' : 'Draft'}</Badge><ChevronRight size={17} className="row-chevron"/></button>;}
export function Empty({ icon, title, text, action, onClick }: {icon: ReactNode; title: string; text: string; action?: string; onClick?: () => void}) {return <div className="empty"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{text}</p>{action && <button className="button secondary" onClick={onClick}><Plus size={15}/>{action}</button>}</div>;}

export function pageAccessLabel(page: Destination) {
  if (page.provider === 'youtube') return page.connection_status === 'revoked' ? 'Disconnected' : page.connection_status === 'expired' ? 'Reconnect needed' : page.publish_capable ? 'Broadcast access verified' : 'Connected';
  if (page.connection_status === 'publish_ready') return page.publish_capable ? 'Publish-ready' : 'Publishing not verified';
  return { requested: 'Awaiting consent', business_approved: 'App authorization needed', oauth_authorized: 'Publishing not verified', expired: 'Access expired', revoked: 'Disconnected' }[page.connection_status];
}
