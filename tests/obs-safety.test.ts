import { describe, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SafeObsController, fingerprint, ingest, type ObsPort, type Settings } from '@/agent/src/safety';
import { FileJournal } from '@/agent/src/journal';
const productionId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
class FakeObs implements ObsPort {
  active=false; recording=true; writes=0; starts=0;
  current: Settings={streamServiceType:'rtmp_custom',streamServiceSettings:{server:'rtmps://previous.example/rtmp/',key:'old-secret'}};
  async status(){return {outputActive:this.active};}
  async settings(){return structuredClone(this.current);}
  async setSettings(value:Settings){if(this.active) throw new Error('OBS_REFUSES_ACTIVE');this.writes++;this.current=structuredClone(value);}
  async start(){this.starts++;this.active=true;}
}
const command=(action:string,extra:Record<string,unknown>={})=>({id:randomUUID(),productionId,issuedAt:Date.now()-10,expiresAt:Date.now()+20000,action,...extra});
async function scenario(run:(obs:FakeObs,engine:SafeObsController,journal:FileJournal,key:string)=>Promise<void>) {
  const dir=await mkdtemp(join(tmpdir(),'prime-obs-')); const obs=new FakeObs(), journal=new FileJournal(dir), key=randomBytes(32).toString('hex');
  try{await run(obs,new SafeObsController(obs,journal,key,productionId),journal,key);}finally{await rm(dir,{recursive:true,force:true});}
}
const destination={server:'rtmps://live-api-s.facebook.com:443/rtmp/',key:'sample-only'};
describe('OBS safety release gates (fake OBS port, not a real Windows rehearsal)',()=>{
  it('active stream rejects configure/start/restore without any changes',async()=>scenario(async(obs,engine)=>{
    obs.active=true;const original=structuredClone(obs.current);
    for(const action of ['CONFIGURE_STREAM_WHEN_IDLE','START_STREAM_AFTER_CONFIRMATION','RESTORE_STREAM_WHEN_IDLE']) await expect(engine.execute(command(action,{destination,confirmed:true}))).rejects.toThrow('BLOCKED_OBS_ACTIVE');
    expect(obs.writes).toBe(0);expect(obs.starts).toBe(0);expect(obs.recording).toBe(true);expect(obs.current).toEqual(original);
  }));
  it('configures, verifies, starts once with confirmation and preserves recording',async()=>scenario(async(obs,engine,journal)=>{
    const result=await engine.execute(command('CONFIGURE_STREAM_WHEN_IDLE',{destination}));
    const stored=await journal.load();expect(JSON.stringify(stored)).not.toContain('old-secret');
    const start=command('START_STREAM_AFTER_CONFIRMATION',{confirmed:true,expectedFingerprint:result.fingerprint});
    expect(await engine.execute(start)).toMatchObject({status:'OBS_ACTIVE'});
    await expect(engine.execute(start)).rejects.toThrow('REPLAY_REJECTED');
    expect(obs.starts).toBe(1);expect(obs.recording).toBe(true);
  }));
  it('requires fresh confirmation and blocks destination changes',async()=>scenario(async(obs,engine)=>{
    const result=await engine.execute(command('CONFIGURE_STREAM_WHEN_IDLE',{destination}));
    await expect(engine.execute(command('START_STREAM_AFTER_CONFIRMATION',{expectedFingerprint:result.fingerprint}))).rejects.toThrow('CONFIRMATION_REQUIRED');
    obs.current.streamServiceSettings.key='operator-changed';
    await expect(engine.execute(command('RESTORE_STREAM_WHEN_IDLE'))).rejects.toThrow('DESTINATION_CHANGED');expect(obs.writes).toBe(1);
  }));
  it('restores an encrypted snapshot only when idle and unchanged',async()=>scenario(async(obs,engine)=>{
    const old=structuredClone(obs.current);await engine.execute(command('CONFIGURE_STREAM_WHEN_IDLE',{destination}));
    expect(await engine.execute(command('RESTORE_STREAM_WHEN_IDLE'))).toMatchObject({status:'RESTORED'});expect(obs.current).toEqual(old);
  }));
  it('claims survive a helper restart and reject replay',async()=>scenario(async(obs,engine,journal,key)=>{
    const c=command('CONFIGURE_STREAM_WHEN_IDLE',{destination});await engine.execute(c);
    const restarted=new SafeObsController(obs,journal,key,productionId);
    await expect(restarted.execute(c)).rejects.toThrow('REPLAY_REJECTED');expect(obs.writes).toBe(1);
  }));
  it('rechecks active state immediately before write',async()=>scenario(async(obs,engine)=>{
    let reads=0;obs.status=async()=>({outputActive:++reads>1});
    await expect(engine.execute(command('CONFIGURE_STREAM_WHEN_IDLE',{destination}))).rejects.toThrow('BLOCKED_OBS_ACTIVE');expect(obs.writes).toBe(0);
  }));
  it('rejects expired, overlong and wrong-production commands and arbitrary methods',async()=>scenario(async(obs,engine)=>{
    for(const overrides of [{expiresAt:Date.now()-1},{expiresAt:Date.now()+60000},{productionId:randomUUID()},{action:'STOP_STREAM'},{action:'SetCurrentProgramScene'},{action:'exec'}]) await expect(engine.execute(command('CONFIGURE_STREAM_WHEN_IDLE',{destination,...overrides}))).rejects.toThrow();
    expect(obs.writes).toBe(0);expect(obs.starts).toBe(0);
  }));
  it('accepts only a narrowly allowed RTMPS ingest, with stable fingerprints',()=>{
    for(const host of ['http://127.0.0.1/','rtmps://evil.test/rtmp/','rtmps://live-api-s.facebook.com.evil.test/rtmp/','rtmps://live-api-s.facebook.com/rtmp/?key=secret']) expect(()=>ingest(host,'key')).toThrow();
    expect(fingerprint({streamServiceType:'x',streamServiceSettings:{a:1,b:2}})).toBe(fingerprint({streamServiceType:'x',streamServiceSettings:{b:2,a:1}}));
  });
});
