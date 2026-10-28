import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const db=new PGlite();
const admin='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', operator='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', client='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
beforeAll(async()=>{
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); grant usage on schema auth to authenticated; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; insert into auth.users values('${admin}'),('${operator}');`);
  await db.exec(await readFile('supabase/migrations/202610280001_initial.sql','utf8'));
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
