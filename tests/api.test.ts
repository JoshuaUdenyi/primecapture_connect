import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const jar=vi.hoisted(()=>new Map<string,string>());
vi.mock('next/headers',()=>({cookies:async()=>({get:(name:string)=>jar.has(name)?{name,value:jar.get(name)}:undefined,getAll:()=>[...jar].map(([name,value])=>({name,value})),set:(name:string,value:string)=>jar.set(name,value),delete:(name:string)=>jar.delete(name)})}));
import { handle } from '@/lib/api';
import { demo } from '@/lib/db/demo';
async function api(path:string,method='GET',value:unknown={},origin='http://localhost:3000',token?:string){
 const request=new Request('http://localhost:3000/api/'+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(method==='POST'?{body:JSON.stringify(value)}:{})});
 return handle(request,path.split('/'));
}
beforeEach(()=>{vi.stubEnv('DEMO_MODE','true');vi.stubEnv('NODE_ENV','test');jar.clear();demo.rates.clear();});
afterEach(()=>vi.unstubAllEnvs());
describe('server authorization and workflow',()=>{
 it('returns actionable setup errors without permitting login when local keys are missing',async()=>{
   vi.stubEnv('SUPABASE_URL','https://sample-project.supabase.co');
   vi.stubEnv('SUPABASE_ANON_KEY','');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','');
   const result=await api('auth/login','POST',{email:'crew@example.invalid'});
   expect(result.status).toBe(503);
   const payload=await result.json();expect(payload.code).toBe('SETUP_REQUIRED');
   expect(payload.error).toContain('SUPABASE_ANON_KEY');expect(payload.error).toContain('SUPABASE_SERVICE_ROLE_KEY');
   expect(payload.error).toContain('.env.local');expect(payload.error).toContain('npm run dev');
   expect((await api('me')).status).toBe(401);
 });
 it('keeps production setup errors generic',async()=>{
   vi.stubEnv('NODE_ENV','production');vi.stubEnv('DEMO_MODE','false');vi.stubEnv('MOCK_META_ENABLED','false');
   vi.stubEnv('SUPABASE_URL','');vi.stubEnv('SUPABASE_ANON_KEY','');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','');
   const result=await api('auth/login','POST',{email:'crew@example.invalid'});
   expect(result.status).toBe(503);const payload=await result.json();
   expect(payload.code).toBe('SETUP_REQUIRED');expect(payload.error).toContain('workspace administrator');
   expect(payload.error).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
 });
 it('returns 401 for protected routes, and blocks cross-site mutations',async()=>{
   for(const path of ['me','clients','destinations','dashboard','audit','youtube/connect']) expect((await api(path)).status).toBe(401);
   expect((await api('auth/demo','POST',{},'https://evil.test')).status).toBe(403);
   expect((await api('youtube/authorize','POST',{invite:'a'.repeat(43)},'https://evil.test')).status).toBe(403);
 });
 it('separates operator and admin roles on every admin endpoint',async()=>{
   await api('auth/demo','POST',{role:'operator'});
   expect((await api('me')).status).toBe(200);
   for(const path of ['audit','agents/pair-code','meta/business-access-request','youtube/connect']) expect((await api(path,path==='audit'?'GET':'POST',{name:'PC'})).status).toBe(403);
 });
 it('creates records, enforces Page identity/client binding, audits and blocks publish',async()=>{
   await api('auth/demo','POST',{});
   const create=await api('clients','POST',{name:'API test client',notes:'Test'});expect(create.status).toBe(201);const client=await create.json();
   expect((await api('destinations','POST',{client_id:client.id,display_name:'Wrong URL',reference:'https://evil.test/12345'})).status).toBe(400);
   const pageRes=await api('destinations','POST',{client_id:client.id,display_name:'Sample Page',reference:'199999999999999'});expect(pageRes.status).toBe(201);const page=await pageRes.json();expect(page.publish_capable).toBe(false);
   const prod=await api('productions','POST',{client_id:client.id,destination_id:page.id,title:'Rehearsal'});expect(prod.status).toBe(201);const p=await prod.json();
   const blocked=await api('productions/'+p.id+'/prepare','POST');expect(blocked.status).toBe(409);expect((await blocked.json()).code).toBe('META_UNVERIFIED');
   expect((await (await api('audit')).json()).some((a:{resource_id:string})=>a.resource_id===p.id)).toBe(true);
   const other=await (await api('clients','POST',{name:'Other client'})).json();
   expect((await api('productions','POST',{client_id:other.id,destination_id:page.id,title:'Wrong client'})).status).toBe(400);
   const disconnected = await api('destinations/'+page.id+'/disconnect','POST');
   expect(disconnected.status).toBe(200);expect(await disconnected.json()).toMatchObject({remote_revocation:false});
   expect(demo.destinations.find(d=>d.id===page.id)).toMatchObject({connection_status:'revoked',publish_capable:false});
 });
 it('pairs once, authenticates polling, hides tokens and enforces revocation',async()=>{
   await api('auth/demo','POST',{});
   const code=await (await api('agents/pair-code','POST',{name:'Test PC'})).json();
   const paired=await api('agents/pair','POST',{code:code.code});expect(paired.status).toBe(201);const device=await paired.json();
   expect((await api('agents/pair','POST',{code:code.code})).status).toBe(401);
   const heartbeat={obs_connected:true,output_active:true,recording_active:true};
   expect((await api('agents/poll','POST',heartbeat)).status).toBe(401);
   const result=await api('agents/poll','POST',heartbeat,'',device.device_token);expect(result.status).toBe(200);expect(await result.json()).toMatchObject({commands:[],control_enabled:false});
   const dashboard=JSON.stringify(await (await api('dashboard')).json());expect(dashboard).not.toContain(device.device_token);expect(dashboard).not.toContain('device_token_hash');
   await api('agents/'+device.agent_id+'/revoke','POST');
   expect((await api('agents/poll','POST',heartbeat,'',device.device_token)).status).toBe(401);
 });
});
