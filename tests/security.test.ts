import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt } from '@/lib/security/crypto';
import { pageId, checkOrigin, body } from '@/lib/security/validation';
import { newOAuthState, validState } from '@/lib/security/oauth-state';
import { MockMetaProvider, GraphMetaProvider } from '@/lib/meta/provider';
import { assertRuntimeSafety } from '@/lib/config';
import { z } from 'zod';
afterEach(() => vi.unstubAllEnvs());
describe('secret encryption', () => {
  const key=randomBytes(32).toString('hex');
  it('authenticates ciphertext and binds it to its record', () => {
    const a=encrypt('private-token',key,'destination:1'), b=encrypt('private-token',key,'destination:1');
    expect(a.iv).not.toBe(b.iv); expect(JSON.stringify(a)).not.toContain('private-token');
    expect(decrypt(a,key,'destination:1')).toBe('private-token');
    expect(()=>decrypt(a,key,'destination:2')).toThrow();
    expect(()=>decrypt(a,randomBytes(32).toString('hex'),'destination:1')).toThrow();
    expect(()=>decrypt({...a,tag:Buffer.alloc(16).toString('base64')},key,'destination:1')).toThrow();
  });
  it('rejects invalid keys',()=>expect(()=>encrypt('x','password','context')).toThrow());
});
describe('request boundaries',()=>{
  it('parses only numeric Page references without fetching arbitrary URLs',()=>{
    expect(pageId('100000000001')).toBe('100000000001');
    expect(pageId('https://www.facebook.com/profile.php?id=100000000001')).toBe('100000000001');
    for(const input of ['https://facebook.com.evil.test/12345','https://evil.test/12345','https://facebook.com@evil.test/12345','https://facebook.com:4430/12345','http://facebook.com/12345','https://facebook.com/username','<script>']) expect(()=>pageId(input)).toThrow();
  });
  it('rejects cross-site/missing origins',()=>{
    vi.stubEnv('APP_BASE_URL','https://connect.test');
    expect(()=>checkOrigin(new Request('https://connect.test/api/clients',{headers:{Origin:'https://evil.test'}}))).toThrow();
    expect(()=>checkOrigin(new Request('https://connect.test/api/clients'))).toThrow();
    expect(()=>checkOrigin(new Request('https://connect.test/api/clients',{headers:{Origin:'https://connect.test'}}))).not.toThrow();
  });
  it('caps chunked bodies and rejects extra JSON keys',async()=>{
    await expect(body(new Request('https://connect.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'x'.repeat(9000)})}),z.object({name:z.string()}))).rejects.toMatchObject({status:413});
    await expect(body(new Request('https://connect.test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"name":"hello","admin":true}'}),z.object({name:z.string()}).strict())).rejects.toMatchObject({status:400});
  });
});
describe('capability gates and OAuth foundation',()=>{
  it('binds state to actor, expiry and one-time consumption',()=>{
    const a=newOAuthState(), b=newOAuthState(); expect(a.state).not.toBe(b.state);
    const row={...a, actor:'staff:1', consumed_at:null};
    expect(validState(row,a.state,'staff:1')).toBe(true);
    expect(validState(row,a.state,'staff:2')).toBe(false);
    expect(validState({...row,consumed_at:new Date().toISOString()},a.state,'staff:1')).toBe(false);
    expect(validState(row,a.state,'staff:1',Date.parse(a.expires_at))).toBe(false);
  });
  it('never presents a simulated Page as publish-ready',async()=>{
    vi.stubEnv('MOCK_META_ENABLED','true'); const provider=new MockMetaProvider();
    expect(await provider.verifyPage('123456')).toMatchObject({publishCapable:false,simulated:true});
    await expect(new GraphMetaProvider().verifyPage()).rejects.toMatchObject({code:'META_UNVERIFIED'});
  });
  it('rejects mocks and demo mode in production even if flags are set',()=>{
    vi.stubEnv('NODE_ENV','production');vi.stubEnv('MOCK_META_ENABLED','true');vi.stubEnv('DEMO_MODE','true');
    expect(()=>new MockMetaProvider()).toThrow(); expect(()=>assertRuntimeSafety()).toThrow();
  });
});
