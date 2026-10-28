import { randomUUID } from 'node:crypto';
import type { Agent, Audit, Client, Destination, Production, Staff } from '@/lib/types';
const now = () => new Date().toISOString();
function makeDemo() {
  const c1 = '11111111-1111-4111-8111-111111111111', c2 = '22222222-2222-4222-8222-222222222222', d1 = '33333333-3333-4333-8333-333333333333';
  return {
    clients: [
      { id: c1, name: 'Grace & Daniel', notes: 'Wedding ceremony · Sample client', created_at: now() },
      { id: c2, name: 'The Gathering', notes: 'Sunday service · Sample client', created_at: now() },
    ] as Client[],
    destinations: [{ id: randomUUID(), client_id: c2, display_name: 'The Gathering · YouTube', external_id: 'UCxxxxxxxxxxxxxxxxxxxxxx', provider: 'youtube', kind: 'channel', connection_status: 'oauth_authorized', publish_capable: false, last_verified_at: null, created_at: now() }, { id: d1, client_id: c1, display_name: 'Grace & Daniel · Wedding', external_id: '100000000000001', provider: 'facebook', kind: 'page', connection_status: 'requested', publish_capable: false, last_verified_at: null, created_at: now() }] as Destination[],
    productions: [{ id: randomUUID(), client_id: c1, destination_id: d1, title: 'Grace & Daniel — Wedding ceremony', status: 'DRAFT', created_by: '00000000-0000-4000-8000-000000000001', created_at: now() }] as Production[],
    agents: [] as (Agent & { device_token_hash: string })[],
    audit_events: [{ id: randomUUID(), actor_user_id: '00000000-0000-4000-8000-000000000001', action: 'simulation.initialized', resource_id: null, created_at: now() }] as Audit[],
    sessions: new Map<string, Staff>(),
    pairings: new Map<string, { name: string; paired_by: string; expires_at: number }>(),
    rates: new Map<string, { count: number; expires: number }>(),
  };
}
const globalDemo = globalThis as typeof globalThis & { primeDemo?: ReturnType<typeof makeDemo> };
export const demo = globalDemo.primeDemo ??= makeDemo();
