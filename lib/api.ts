import { randomBytes, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { requireStaff } from '@/lib/auth/session';
import { assertRuntimeSafety, isDemo, authConfigured } from '@/lib/config';
import { demo } from '@/lib/db/demo';
import { adminDb, authClient } from '@/lib/db/server';
import { list, get, write, revokeAgent } from '@/lib/db/repository';
import { ApiError } from '@/lib/security/errors';
import { body, checkOrigin, pageId, uuid } from '@/lib/security/validation';
import { rateLimit } from '@/lib/security/rate-limit';
import { hash } from '@/lib/security/crypto';
const name = z.string().trim().min(2).max(120);
const now = () => new Date().toISOString();
const response = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } });
export async function handle(request: Request, path: string[]) {
  const route = path.join('/');
  const method = request.method;
  try {
    assertRuntimeSafety();
    if (method === 'GET' && route === 'health') return response({ status: 'ok' });
    const deviceRoute = ['agents/pair', 'agents/poll'].includes(route);
    if (method !== 'GET' && !deviceRoute) checkOrigin(request);
    if (method === 'POST' && route === 'auth/demo') {
      if (!isDemo()) throw new ApiError(404, 'NOT_FOUND', 'Not available.');
      await rateLimit('demo-login', 20);
      const { role } = await body(request, z.object({ role: z.enum(['admin', 'operator']).default('admin') }).strict());
      const token = randomBytes(32).toString('base64url');
      // Demo sessions are local process memory and never valid in production.
      if (demo.sessions.size > 100) demo.sessions.clear();
      demo.sessions.set(token, { user_id: '00000000-0000-4000-8000-000000000001', email: 'crew@simulation.local', role, is_active: true });
      (await cookies()).set('pc-demo', token, { httpOnly: true, sameSite: 'strict', secure: false, path: '/', maxAge: 28800 });
      return response({ ok: true });
    }
    if (method === 'POST' && route === 'auth/login') {
      if (!authConfigured()) throw new ApiError(503, 'SETUP_REQUIRED', 'Configure Supabase to enable staff sign-in.');
      const { email } = await body(request, z.object({ email: z.email().max(254) }).strict());
      // Global + per-email limits work across serverless instances via Postgres.
      await rateLimit('staff-login-global', 20); await rateLimit('staff-login:' + email.toLowerCase(), 3);
      const { data, error } = await adminDb().from('staff_profiles').select('user_id').eq('email', email.toLowerCase()).eq('is_active', true).maybeSingle();
      if (error) throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Sign-in is temporarily unavailable.');
      if (data) {
        const base = process.env.APP_BASE_URL;
        if (!base || (process.env.NODE_ENV === 'production' && new URL(base).protocol !== 'https:')) throw new ApiError(503, 'SETUP_REQUIRED', 'Set the verified application URL.');
        const { error: authError } = await (await authClient()).auth.signInWithOtp({ email: email.toLowerCase(), options: { shouldCreateUser: false, emailRedirectTo: new URL('/auth/callback', base).href } });
        if (authError) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Sign-in is temporarily unavailable.');
      }
      return response({ message: 'If this is an approved staff account, a sign-in link is on its way.' });
    }
    if (method === 'POST' && deviceRoute) return await deviceRequest(request, route);
    if (method === 'POST' && route === 'auth/logout') {
      if (isDemo()) { demo.sessions.delete((await cookies()).get('pc-demo')?.value ?? ''); (await cookies()).delete('pc-demo'); }
      else await (await authClient()).auth.signOut();
      return response({ ok: true });
    }
    const staff = await requireStaff(route === 'audit' || route === 'agents/pair-code' || /^agents\/[^/]+\/revoke$/.test(route) || route === 'meta/business-access-request' || /^destinations\/[^/]+\/disconnect$/.test(route) ? ['admin'] : undefined);
    if (method === 'POST') await rateLimit(staff.user_id + ':mutations', 40);
    if (method === 'GET' && route === 'me') return response({ staff, demo: isDemo() });
    if (method === 'GET' && route === 'dashboard') {
      const [clients, destinations, productions, agents, audit] = await Promise.all([list('clients'), list('destinations'), list('productions'), list('agents'), staff.role === 'admin' ? list('audit_events') : Promise.resolve([])]);
      return response({ staff, demo: isDemo(), clients, destinations, productions, agents, audit });
    }
    if (method === 'GET' && ['clients', 'destinations', 'productions', 'agents', 'audit'].includes(route)) return response(await list(route === 'audit' ? 'audit_events' : route as 'clients' | 'destinations' | 'productions' | 'agents'));
    if (method === 'POST' && route === 'clients') {
      const input = await body(request, z.object({ name, notes: z.string().trim().max(1000).default('') }).strict());
      return response(await write('clients', { ...input, id: randomUUID(), created_at: now() }, staff, 'client.created'), 201);
    }
    if (method === 'POST' && route === 'destinations') {
      const input = await body(request, z.object({ client_id: uuid, display_name: name, reference: z.string().max(500) }).strict());
      await get('clients', input.client_id);
      return response(await write('destinations', { id: randomUUID(), client_id: input.client_id, display_name: input.display_name, external_id: pageId(input.reference), provider: 'facebook', kind: 'page', connection_status: 'requested', publish_capable: false, last_verified_at: null, created_at: now() }, staff, 'destination.registered'), 201);
    }
    if (method === 'POST' && route === 'productions') {
      const input = await body(request, z.object({ client_id: uuid, destination_id: uuid.nullable().default(null), title: name }).strict());
      await get('clients', input.client_id);
      if (input.destination_id && (await get('destinations', input.destination_id)).client_id !== input.client_id) throw new ApiError(400, 'CLIENT_MISMATCH', 'Choose a Page belonging to this client.');
      return response(await write('productions', { ...input, id: randomUUID(), status: 'DRAFT', created_by: staff.user_id, created_at: now() }, staff, 'production.created'), 201);
    }
    if (method === 'POST' && /^destinations\/[^/]+\/disconnect$/.test(route)) {
      const id = uuid.parse(path[1]); await get('destinations', id);
      if (isDemo()) {
        Object.assign(demo.destinations.find(d => d.id === id)!, {connection_status:'revoked',publish_capable:false,last_verified_at:null});
        demo.audit_events.unshift({id:randomUUID(),actor_user_id:staff.user_id,action:'destination.disconnected_locally',resource_id:id,created_at:now()});
      } else {
        const {error} = await adminDb().rpc('disconnect_destination',{page_id:id,actor:staff.user_id});
        if(error) throw new ApiError(503,'DATABASE_UNAVAILABLE','Could not disconnect Page.');
      }
      return response({ok:true,remote_revocation:false,message:'Local access removed. The Page owner must also revoke access in Meta Business settings.'});
    }
    if (method === 'POST' && route === 'agents/pair-code') {
      const { name: deviceName } = await body(request, z.object({ name }).strict());
      const code = randomBytes(10).toString('hex').toUpperCase();
      const expires_at = new Date(Date.now() + 300000).toISOString();
      if (isDemo()) { demo.pairings.set(hash(code), { name: deviceName, paired_by: staff.user_id, expires_at: Date.parse(expires_at) }); demo.audit_events.unshift({id:randomUUID(),actor_user_id:staff.user_id,action:'agent.pairing_requested',resource_id:null,created_at:now()}); }
      else {
        const { error } = await adminDb().rpc('create_pairing', { code_hash: hash(code), device_name: deviceName, actor: staff.user_id, expiry: expires_at });
        if (error) throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Could not create pairing code.');
      }
      return response({ code, expires_at }, 201);
    }
    if (method === 'POST' && /^agents\/[^/]+\/revoke$/.test(route)) {
      const id = uuid.parse(path[1]); await revokeAgent(id, staff); return response({ ok: true });
    }
    if (method === 'POST' && /^productions\/[^/]+\/prepare$/.test(route)) {
      await get('productions', uuid.parse(path[1]));
      throw new ApiError(409, 'META_UNVERIFIED', 'Facebook publishing is blocked until approved permissions and a controlled end-to-end test are documented. Use the manual handoff checklist.');
    }
    if (method === 'POST' && /^(meta\/(connect|business-access-request)|destinations\/[^/]+\/verify|broadcasts\/[^/]+\/(configure|start))$/.test(route)) {
      throw new ApiError(409, 'CAPABILITY_BLOCKED', 'This capability is disabled pending Meta approval and production safety validation. No remote action was performed.');
    }
    throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found.');
  } catch (error) {
    const id = randomUUID();
    if (error instanceof ApiError) return response({ error: error.message, code: error.code, request_id: id }, error.status);
    if (error instanceof z.ZodError) return response({ error: 'Invalid record identifier.', code: 'INVALID_INPUT', request_id: id }, 400);
    // Never serialize third-party errors, payloads, tokens, URLs or exception messages.
    return response({ error: 'The request could not be completed. Check configuration or contact your administrator.', code: 'INTERNAL_ERROR', request_id: id }, 500);
  }
}
async function deviceRequest(request: Request, route: string) {
  if (process.env.NODE_ENV === 'production' && !process.env.APP_BASE_URL?.startsWith('https://')) throw new ApiError(503, 'SETUP_REQUIRED', 'HTTPS configuration is required.');
  if (route === 'agents/pair') {
    await rateLimit('device-pair-global', 20);
    const { code } = await body(request, z.object({ code: z.string().regex(/^[A-F0-9]{20}$/) }).strict());
    const token = randomBytes(32).toString('base64url');
    let id: string;
    if (isDemo()) {
      const pair = demo.pairings.get(hash(code));
      if (!pair || pair.expires_at <= Date.now()) throw new ApiError(401, 'PAIRING_INVALID', 'Pairing code is invalid, expired, or already used.');
      demo.pairings.delete(hash(code)); id = randomUUID();
      demo.agents.push({ id, name: pair.name, paired_by: pair.paired_by, last_seen_at: null, revoked_at: null, obs_connected: false, output_active: false, recording_active: false, created_at: now(), device_token_hash: hash(token) });
      demo.audit_events.unshift({ id: randomUUID(), actor_user_id: pair.paired_by, action: 'agent.paired', resource_id: id, created_at: now() });
    } else {
      const { data, error } = await adminDb().rpc('claim_pairing', { code_hash: hash(code), token_hash: hash(token) });
      if (error || !data) throw new ApiError(401, 'PAIRING_INVALID', 'Pairing code is invalid, expired, or already used.');
      id = data;
    }
    return response({ agent_id: id, device_token: token }, 201);
  }
  const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) throw new ApiError(401, 'DEVICE_UNAUTHORIZED', 'Device authentication required.');
  const input = await body(request, z.object({ obs_connected: z.boolean(), output_active: z.boolean(), recording_active: z.boolean() }).strict());
  let id: string;
  if (isDemo()) {
    const agent = demo.agents.find(a => a.device_token_hash === hash(token) && !a.revoked_at);
    if (!agent) throw new ApiError(401, 'DEVICE_UNAUTHORIZED', 'Device is unauthorized or revoked.');
    id = agent.id; await rateLimit('device-poll:' + id, 45);
    Object.assign(agent, input, { last_seen_at: now() });
  } else {
    const { data, error } = await adminDb().from('agents').select('id').eq('device_token_hash', hash(token)).is('revoked_at', null).maybeSingle();
    if (error || !data) throw new ApiError(401, 'DEVICE_UNAUTHORIZED', 'Device is unauthorized or revoked.');
    id = data.id; await rateLimit('device-poll:' + id, 45);
    const { error: updateError } = await adminDb().from('agents').update({ ...input, last_seen_at: now() }).eq('id', id).is('revoked_at', null);
    if (updateError) throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Heartbeat failed.');
  }
  // Phase 1: status-only pairing. No cloud stream-control command can be issued.
  return response({ agent_id: id, commands: [], control_enabled: false });
}
