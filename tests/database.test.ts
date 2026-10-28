import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const db=new PGlite();
const admin='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', operator='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', client='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
beforeAll(async()=>{
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); grant usage on schema auth to authenticated; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; insert into auth.users values('${admin}'),('${operator}');`);
  await db.exec(await readFile('supabase/migrations/202610280001_initial.sql','utf8'));
  await db.exec(await readFile('supabase/migrations/202610280002_youtube.sql','utf8'));
  await db.exec(`insert into public.staff_profiles(user_id,email,role) values('${admin}','admin@example.test','admin'),('${operator}','operator@example.test','operator');`);
},30000);
afterAll(async()=>{await db.close();});
async function asRole(role:string,actor:string,sql:string){
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${actor}',false);`);
  try{return await db.exec(sql);}finally{await db.exec('reset role');}
}
describe('actual PostgreSQL migration / RLS / transaction tests',()=>{
  it('allows a staff insert with atomic audit and denies RPC execution to browser roles',async()=>{
    const record={id:client,name:'Test client',notes:'',created_at:new Date().toISOString()};
    await db.query('select public.create_staff_record($1,$2,$3,$4)',['clients',record,operator,'client.created']);
    expect((await db.query('select count(*)::int as n from public.audit_events')).rows).toEqual([{n:1}]);
    await expect(asRole('authenticated',operator,`select public.create_staff_record('clients','{}','${operator}','client.created')`)).rejects.toThrow(/permission denied/);
  });
  it('blocks anonymous tables, browser writes and all credential tables',async()=>{
    await expect(asRole('anon','',`select * from public.clients`)).rejects.toThrow(/permission denied/);
    await expect(asRole('authenticated',operator,`insert into public.clients(name) values('Nope')`)).rejects.toThrow(/permission denied/);
    for(const table of ['meta_credentials','agents','pairing_codes','obs_snapshots','agent_commands']) await expect(asRole('authenticated',admin,`select * from public.${table}`)).rejects.toThrow(/permission denied/);
  });
  it('shows staff clients but only admin audit, with disabled staff denied',async()=>{
    const clients=await asRole('authenticated',operator,`select count(*)::int as n from public.clients`);expect(clients[0].rows).toEqual([{n:1}]);
    expect((await asRole('authenticated',operator,`select * from public.audit_events`))[0].rows).toEqual([]);
    expect((await asRole('authenticated',admin,`select count(*)::int as n from public.audit_events`))[0].rows).toEqual([{n:1}]);
    await db.exec(`update public.staff_profiles set is_active=false where user_id='${operator}'`);
    expect((await asRole('authenticated',operator,`select * from public.clients`))[0].rows).toEqual([]);
    await expect(db.query('select public.create_staff_record($1,$2,$3,$4)',['clients',{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',name:'Disabled'},operator,'client.created'])).rejects.toThrow(/staff required/);
    await db.exec(`update public.staff_profiles set is_active=true where user_id='${operator}'`);
  });
  it('enforces one-use pairing and administrator approval',async()=>{
    const code='a'.repeat(64),token='b'.repeat(64),expiry=new Date(Date.now()+290000).toISOString();
    await expect(db.query('select public.create_pairing($1,$2,$3,$4)',[code,'Production PC',operator,expiry])).rejects.toThrow(/admin required/);
    await db.query('select public.create_pairing($1,$2,$3,$4)',[code,'Production PC',admin,expiry]);
    const result=await db.query<{claim_pairing:string}>('select public.claim_pairing($1,$2)',[code,token]);expect(result.rows[0].claim_pairing).toMatch(/^[a-f0-9-]{36}$/);
    await expect(db.query('select public.claim_pairing($1,$2)',[code,token])).rejects.toThrow(/invalid pairing/);
    await db.query('select public.revoke_agent($1,$2)',[result.rows[0].claim_pairing,admin]);
    expect((await db.query<{revoked_at:unknown}>('select revoked_at from public.agents')).rows[0].revoked_at).not.toBeNull();
  });
  it('rate limits atomically across requests',async()=>{
    expect((await db.query('select public.consume_rate_limit($1,$2) as allowed',['test',1])).rows).toEqual([{allowed:true}]);
    expect((await db.query('select public.consume_rate_limit($1,$2) as allowed',['test',1])).rows).toEqual([{allowed:false}]);
  });
});

describe('YouTube database consent, credentials and creation safety', () => {
  const clientA = '11111111-1111-4111-8111-111111111111', clientB = '22222222-2222-4222-8222-222222222222';
  const ticket = '33333333-3333-4333-8333-333333333333', destination = '44444444-4444-4444-8444-444444444444';
  const production = '55555555-5555-4555-8555-555555555555', operation = '66666666-6666-4666-8666-666666666666';
  const channel = 'UC' + 'x'.repeat(22), envelope = { ciphertext: 'encrypted', iv: 'iv', tag: 'tag', key_version: 1 };
  const expiry = () => new Date(Date.now() + 3600000).toISOString();
  beforeAll(async () => { await db.query('insert into public.clients(id,name) values($1,$2),($3,$4)', [clientA,'YouTube client A',clientB,'YouTube client B']); });
  it('protects all new tables and RPCs and validates provider identity', async () => {
    for (const table of ['youtube_oauth_requests','youtube_credentials','youtube_broadcasts']) {
      for (const role of ['anon','authenticated']) await expect(asRole(role,admin,`select * from public.${table}`)).rejects.toThrow(/permission denied/);
    }
    await expect(asRole('authenticated',admin,`select public.create_youtube_invite('${ticket}','${'a'.repeat(64)}','${clientA}','${admin}',now()+interval '1 hour')`)).rejects.toThrow(/permission denied/);
    await expect(db.query("insert into public.destinations(client_id,provider,kind,external_id,display_name) values($1,'youtube','page',$2,'Invalid')",[clientA,channel])).rejects.toThrow(/check constraint/);
    await expect(db.query('select public.create_youtube_invite($1,$2,$3,$4,$5)', [ticket,'a'.repeat(64),clientA,operator,expiry()])).rejects.toThrow(/admin required/);
  });
  it('atomically consumes browser-bound consent once and saves only encrypted credentials', async () => {
    await db.query('select public.create_youtube_invite($1,$2,$3,$4,$5)', [ticket,'a'.repeat(64),clientA,admin,expiry()]);
    await db.query('select public.begin_youtube_oauth($1,$2,$3,$4)', ['a'.repeat(64),'b'.repeat(64),'c'.repeat(64),envelope]);
    await expect(db.query('select public.begin_youtube_oauth($1,$2,$3,$4)', ['a'.repeat(64),'d'.repeat(64),'e'.repeat(64),envelope])).rejects.toThrow(/invalid invitation/);
    expect((await db.query('select * from public.claim_youtube_oauth($1,$2)',['b'.repeat(64),'wrong-browser'])).rows).toHaveLength(0);
    expect((await db.query('select * from public.claim_youtube_oauth($1,$2)',['b'.repeat(64),'c'.repeat(64)])).rows).toHaveLength(1);
    expect((await db.query('select * from public.claim_youtube_oauth($1,$2)',['b'.repeat(64),'c'.repeat(64)])).rows).toHaveLength(0);
    await db.query('select public.save_youtube_connection($1,$2,$3,$4,$5)', [ticket,destination,channel,'Client A channel',envelope]);
    const rows = (await db.query('select connection_status,publish_capable from public.destinations where id=$1',[destination])).rows;
    expect(rows).toEqual([{connection_status:'oauth_authorized',publish_capable:false}]);
    expect((await db.query('select encrypted_verifier from public.youtube_oauth_requests where id=$1',[ticket])).rows).toEqual([{encrypted_verifier:null}]);
    await expect(db.query('select public.save_youtube_connection($1,$2,$3,$4,$5)', [ticket,destination,channel,'Replay',envelope])).rejects.toThrow(/invalid consent/);
  });
  it('refuses to move a channel into a different client through consent', async () => {
    const other = '77777777-7777-4777-8777-777777777777';
    await db.query('select public.create_youtube_invite($1,$2,$3,$4,$5)', [other,'d'.repeat(64),clientB,admin,expiry()]);
    await db.query('select public.begin_youtube_oauth($1,$2,$3,$4)', ['d'.repeat(64),'e'.repeat(64),'f'.repeat(64),envelope]);
    await db.query('select * from public.claim_youtube_oauth($1,$2)',['e'.repeat(64),'f'.repeat(64)]);
    await expect(db.query('select public.save_youtube_connection($1,$2,$3,$4,$5)', [other,other,channel,'Wrong client',envelope])).rejects.toThrow(/another client/);
    expect((await db.query('select client_id from public.destinations where id=$1',[destination])).rows).toEqual([{client_id:clientA}]);
  });
  it('claims one creation per production and records binding before declaring broadcast access', async () => {
    await db.query('insert into public.productions(id,client_id,destination_id,title,created_by) values($1,$2,$3,$4,$5)',[production,clientA,destination,'Test broadcast',operator]);
    const args = [production,operator,expiry(),'private',false,operation];
    const first = await db.query<{ result: { id: string; operation_key: string } }>('select public.claim_youtube_broadcast($1,$2,$3,$4,$5,$6) as result',args);
    const second = await db.query<{ result: { id: string; operation_key: string } }>('select public.claim_youtube_broadcast($1,$2,$3,$4,$5,$6) as result',[...args.slice(0,5),ticket]);
    expect(second.rows[0].result.id).toBe(first.rows[0].result.id);
    expect(second.rows[0].result.operation_key).toBe(operation);
    const id = first.rows[0].result.id;
    await expect(db.query('select public.checkpoint_youtube_broadcast($1,$2,$3,$4)',[id,operator,'ready',null])).rejects.toThrow(/channel unavailable/);
    await db.query('select public.checkpoint_youtube_broadcast($1,$2,$3,$4)',[id,operator,'broadcast','broadcast01']);
    await db.query('select public.checkpoint_youtube_broadcast($1,$2,$3,$4)',[id,operator,'stream','stream00001']);
    await db.query('select public.checkpoint_youtube_broadcast($1,$2,$3,$4)',[id,operator,'ready',null]);
    expect((await db.query('select status from public.youtube_broadcasts where id=$1',[id])).rows).toEqual([{status:'READY'}]);
    expect((await db.query('select status from public.productions where id=$1',[production])).rows).toEqual([{status:'BROADCAST_PREPARED'}]);
    expect((await db.query('select publish_capable from public.destinations where id=$1',[destination])).rows).toEqual([{publish_capable:true}]);
  });
  it('expires links, rechecks administrator access and cancels pending consent when disconnected', async () => {
    const pending = '88888888-8888-4888-8888-888888888888';
    await db.query('select public.create_youtube_invite($1,$2,$3,$4,$5)', [pending,'1'.repeat(64),clientA,admin,expiry()]);
    await db.query('select public.begin_youtube_oauth($1,$2,$3,$4)', ['1'.repeat(64),'2'.repeat(64),'3'.repeat(64),envelope]);
    await db.query('update public.staff_profiles set is_active=false where user_id=$1',[admin]);
    expect((await db.query('select * from public.claim_youtube_oauth($1,$2)',['2'.repeat(64),'3'.repeat(64)])).rows).toHaveLength(0);
    await db.query('update public.staff_profiles set is_active=true where user_id=$1',[admin]);
    await db.query('select public.disconnect_destination($1,$2)', [destination,admin]);
    expect((await db.query('select * from public.claim_youtube_oauth($1,$2)',['2'.repeat(64),'3'.repeat(64)])).rows).toHaveLength(0);
    expect((await db.query('select * from public.youtube_credentials where destination_id=$1',[destination])).rows).toHaveLength(0);
    expect((await db.query('select status,youtube_broadcast_id from public.youtube_broadcasts where production_id=$1',[production])).rows).toEqual([{status:'READY',youtube_broadcast_id:'broadcast01'}]);
    await expect(db.query('select public.claim_youtube_broadcast($1,$2,$3,$4,$5,$6)',[production,operator,expiry(),'private',false,ticket])).rejects.toThrow(/connection required/);
    const expired = '99999999-9999-4999-8999-999999999999';
    await db.query('select public.create_youtube_invite($1,$2,$3,$4,$5)',[expired,'4'.repeat(64),clientB,admin,expiry()]);
    await db.query("update public.youtube_oauth_requests set expires_at=now()-interval '1 minute' where id=$1",[expired]);
    await expect(db.query('select public.begin_youtube_oauth($1,$2,$3,$4)', ['4'.repeat(64),'5'.repeat(64),'6'.repeat(64),envelope])).rejects.toThrow(/invalid invitation/);
  });
});
