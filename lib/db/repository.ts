import 'server-only';
import { randomUUID } from 'node:crypto';
import { isDemo } from '@/lib/config';
import { demo } from './demo';
import { adminDb } from './server';
import { ApiError } from '@/lib/security/errors';
import type { Agent, Audit, Client, Destination, Production, Staff } from '@/lib/types';
type Tables = { clients: Client; destinations: Destination; productions: Production; agents: Agent; audit_events: Audit };
const selects = {
  clients: 'id,name,notes,created_at',
  destinations: 'id,client_id,external_id,display_name,provider,kind,connection_status,publish_capable,last_verified_at,created_at',
  productions: 'id,client_id,destination_id,title,status,created_by,created_at',
  agents: 'id,name,paired_by,last_seen_at,revoked_at,obs_connected,output_active,recording_active,created_at',
  audit_events: 'id,actor_user_id,action,resource_id,created_at',
};
export async function list<T extends keyof Tables>(table: T): Promise<Tables[T][]> {
  if (isDemo()) return structuredClone(demo[table]).map(row => {
    // Explicit projection keeps device credentials out of any browser response.
    const output: Record<string, unknown> = {};
    for (const field of selects[table].split(',')) output[field] = (row as unknown as Record<string, unknown>)[field];
    return output as Tables[T];
  }).sort((a,b) => b.created_at.localeCompare(a.created_at));
  const { data, error } = await adminDb().from(table).select(selects[table]).order('created_at', { ascending: false }).limit(200);
  if (error) throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Database operation failed. Check deployment configuration.');
  return data as unknown as Tables[T][];
}
export async function get<T extends keyof Tables>(table: T, id: string): Promise<Tables[T]> {
  if (isDemo()) {
    const item = (await list(table)).find(row => row.id === id);
    if (!item) throw new ApiError(404, 'NOT_FOUND', 'Record not found.');
    return item;
  }
  const { data, error } = await adminDb().from(table).select(selects[table]).eq('id', id).maybeSingle();
  if (error) throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Database operation failed.');
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Record not found.');
  return data as unknown as Tables[T];
}
export async function write<T extends keyof Tables>(table: T, row: Tables[T], staff: Staff, action: string): Promise<Tables[T]> {
  if (isDemo()) {
    if (table === 'destinations' && demo.destinations.some(d => d.provider === (row as Destination).provider && d.external_id === (row as Destination).external_id)) throw new ApiError(409, 'DUPLICATE', 'That destination is already registered.');
    (demo[table] as Tables[T][]).unshift(row);
    demo.audit_events.unshift({ id: randomUUID(), actor_user_id: staff.user_id, action, resource_id: row.id, created_at: new Date().toISOString() });
    return row;
  }
  // Atomic record + audit transaction; a failed audit rolls back the write.
  const { error } = await adminDb().rpc('create_staff_record', { table_name: table, record: row, actor: staff.user_id, event_action: action });
  if (error?.code === '23505') throw new ApiError(409, 'DUPLICATE', 'That record already exists.');
  if (error) throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Could not save the record.');
  return row;
}
export async function revokeAgent(id: string, staff: Staff) {
  await get('agents', id);
  if (isDemo()) {
    demo.agents.find(a => a.id === id)!.revoked_at = new Date().toISOString();
    demo.audit_events.unshift({ id: randomUUID(), actor_user_id: staff.user_id, action: 'agent.revoked', resource_id: id, created_at: new Date().toISOString() });
  } else {
    const { error } = await adminDb().rpc('revoke_agent', { device_id: id, actor: staff.user_id });
    if (error) throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Could not revoke device.');
  }
}
