import OBSWebSocket from 'obs-websocket-js/json';
import { createInterface } from 'node:readline/promises';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
const credentials = z.object({ agent_id: z.uuid(), device_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), origin: z.url() });
const directory = resolve(process.env.AGENT_STATE_DIR || 'agent/.state');
const origin = new URL(process.env.CONNECT_APP_URL || 'https://invalid.example');
const localDev = process.env.AGENT_ALLOW_LOCAL_DEVELOPMENT === 'true' && origin.protocol === 'http:' && ['localhost','127.0.0.1'].includes(origin.hostname);
if ((!localDev && origin.protocol !== 'https:') || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || origin.hostname === 'invalid.example') throw new Error('Set CONNECT_APP_URL to your verified HTTPS app origin.');
async function request(path: string, payload: unknown, token?: string) {
  const result = await fetch(new URL(path,origin), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(payload) });
  if (!result.ok) throw new Error(result.status === 401 ? 'DEVICE_UNAUTHORIZED' : 'CLOUD_UNAVAILABLE');
  return result.json();
}
async function deadline<T>(operation: Promise<T>, ms=5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('OBS_TIMEOUT')),ms);})]); } finally { clearTimeout(timer); }
}
async function main() {
  if (process.argv.includes('--pair')) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    let code: string;
    try { code = (await prompt.question('One-time pairing code: ')).trim().toUpperCase(); } finally { prompt.close(); }
    if (!/^[A-F0-9]{20}$/.test(code)) throw new Error('INVALID_PAIRING_CODE');
    // Existing credentials are never overwritten without a deliberate local removal.
    await mkdir(directory,{recursive:true,mode:0o700});
    try { await readFile(join(directory,'device.json')); throw new Error('ALREADY_PAIRED'); } catch(e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const value = credentials.parse({ ...await request('/api/agents/pair',{code}), origin: origin.origin });
    await writeFile(join(directory,'device.json'),JSON.stringify(value),{mode:0o600,flag:'wx'});
    console.log('Device paired. Credentials saved locally. Run npm run agent for status-only monitoring.'); return;
  }
  const value = credentials.parse(JSON.parse(await readFile(join(directory,'device.json'),'utf8')));
  if (value.origin !== origin.origin) throw new Error('ORIGIN_MISMATCH_REPAIR_REQUIRED');
  if (!process.env.OBS_WEBSOCKET_PASSWORD) throw new Error('Set the local OBS WebSocket password.');
  const obs = new OBSWebSocket();
  let connected = false, stopped = false, failures = 0;
  const disconnect = () => { connected = false; };
  obs.on('ConnectionClosed',disconnect); obs.on('ConnectionError',disconnect);
  const stop = () => { stopped = true; }; process.on('SIGINT',stop); process.on('SIGTERM',stop);
  console.log('Status-only monitoring. OBS connects only to 127.0.0.1:4455. No stream-control commands are accepted.');
  while (!stopped) {
    let output_active = false, recording_active = false;
    try {
      if (!connected) { await deadline(obs.connect('ws://127.0.0.1:4455',process.env.OBS_WEBSOCKET_PASSWORD)); connected = true; }
      const [stream,recording] = await deadline(Promise.all([obs.call('GetStreamStatus'),obs.call('GetRecordStatus')]));
      output_active = stream.outputActive; recording_active = recording.outputActive;
    } catch { connected = false; await deadline(obs.disconnect(),1000).catch(() => {}); }
    try {
      const result = await request('/api/agents/poll',{obs_connected:connected,output_active,recording_active},value.device_token);
      if (result.control_enabled !== false || !Array.isArray(result.commands) || result.commands.length) throw new Error('UNEXPECTED_COMMANDS_REJECTED');
      failures = 0;
    } catch(e) {
      if (e instanceof Error && e.message === 'DEVICE_UNAUTHORIZED') { console.error('Device authorization revoked or expired. Re-pair through an administrator.'); break; }
      failures = Math.min(failures+1,5); console.error('Cloud heartbeat unavailable. OBS is unchanged.');
    }
    if (!stopped) await new Promise(resolve => setTimeout(resolve,Math.min(30000,2000*2**failures)));
  }
  await deadline(obs.disconnect(),1000).catch(() => {});
}
main().catch(() => { console.error('Helper could not start. Check local configuration, device credentials and the Windows setup guide. No OBS settings were changed.'); process.exitCode=1; });
