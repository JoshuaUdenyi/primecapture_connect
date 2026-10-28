import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name: string, value: string) => jar.set(name, value) }) }));
vi.mock('@/lib/youtube/store', () => ({ youtubeRpc: vi.fn(), refreshEnvelope: vi.fn(), productionBroadcast: vi.fn() }));
vi.mock('@/lib/db/repository', () => ({ get: vi.fn() }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimit: vi.fn() }));
import * as google from '@/lib/youtube/provider';
import * as store from '@/lib/youtube/store';
import { get } from '@/lib/db/repository';
import { beginAuthorization, completeAuthorization, prepareYouTube, prepareYouTubeSchema, checkYouTubeStatus } from '@/lib/youtube/service';
import { encrypt, decrypt, hash } from '@/lib/security/crypto';
import type { Destination, Production, Staff } from '@/lib/types';
const key = 'ab'.repeat(32), channel = 'UC' + 'x'.repeat(22);
const staff: Staff = { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@example.test', role: 'admin', is_active: true };
const destination: Destination = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', client_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', provider: 'youtube', kind: 'channel', external_id: channel, display_name: 'Client channel', connection_status: 'oauth_authorized', publish_capable: false, last_verified_at: null, created_at: new Date().toISOString() };
const production: Production = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', client_id: destination.client_id, destination_id: destination.id, title: 'Client ceremony', status: 'DRAFT', created_by: staff.user_id, created_at: new Date().toISOString() };
const input = () => ({ scheduled_start_at: new Date(Date.now() + 3600000).toISOString(), privacy: 'private' as const, made_for_kids: false, confirmed: true as const });
function ok(value: unknown) { return Response.json(value); }
const fetcher = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); jar.clear();
  vi.stubEnv('DEMO_MODE', 'false'); vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('YOUTUBE_CLIENT_ID', 'example-client'); vi.stubEnv('YOUTUBE_CLIENT_SECRET', 'private-client-secret'); vi.stubEnv('TOKEN_ENCRYPTION_KEY', key); vi.stubEnv('APP_BASE_URL', 'http://localhost:3000');
  vi.stubGlobal('fetch', fetcher);
  vi.mocked(get).mockImplementation(async (table) => (table === 'productions' ? production : destination) as never);
  vi.mocked(store.refreshEnvelope).mockResolvedValue(encrypt('private-refresh-token', key, `youtube:refresh:${destination.client_id}:${channel}`));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function remotePreparation({ wrongChannel = false, timeout = false } = {}) {
  fetcher.mockImplementation(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/token')) return ok({ access_token: 'private-access-token' });
    if (path.endsWith('/channels')) return ok({ items: [{ id: wrongChannel ? 'UC' + 'y'.repeat(22) : channel, snippet: { title: 'Client channel' } }] });
    if (path.endsWith('/liveBroadcasts/bind')) return ok({ id: 'broadcast01', contentDetails: { boundStreamId: 'stream00001' } });
    if (path.endsWith('/liveStreams')) return ok({ id: 'stream00001', cdn: { ingestionInfo: { streamName: 'never-return-this-key' } } });
    if (path.endsWith('/liveBroadcasts') && init.method === 'POST') {
      if (timeout) throw new Error('timed out with private detail');
      return ok({ id: 'broadcast01' });
    }
    if (new URL(url).searchParams.has('id')) return ok({ items: [{ id: 'broadcast01', snippet: { channelId: channel }, status: { lifeCycleStatus: 'ready', privacyStatus: 'private' }, contentDetails: { boundStreamId: 'stream00001', enableAutoStart: false, enableAutoStop: false } }] });
    return ok({ items: [] });
  });
}
describe('YouTube OAuth and API workflow', () => {
  it('binds public client consent to one-use state, browser cookie and PKCE, and encrypts refresh credentials', async () => {
    let stateDigest = '', verifierEnvelope: unknown;
    vi.mocked(store.youtubeRpc).mockImplementation(async (name, args) => {
      if (name === 'begin_youtube_oauth') { stateDigest = args.state_digest as string; verifierEnvelope = args.verifier; return 'ticket' as never; }
      if (name === 'claim_youtube_oauth') return [{ id: 'ticket', actor: staff.user_id, client_id: destination.client_id, state_hash: stateDigest, encrypted_verifier: verifierEnvelope }] as never;
      return destination.id as never;
    });
    const started = await beginAuthorization(randomBytes(32).toString('base64url'));
    const url = new URL(started.authorization_url), state = url.searchParams.get('state')!;
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('scope')).toBe(google.youtubeScope);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(started.authorization_url).not.toContain('private-client-secret');
    expect(stateDigest).toBe(hash(state)); expect(jar.get('pc-youtube-browser')).toHaveLength(43);
    fetcher.mockResolvedValueOnce(ok({ access_token: 'private-access-token', refresh_token: 'private-refresh-token', scope: google.youtubeScope })).mockResolvedValueOnce(ok({ items: [{ id: channel, snippet: { title: 'Client channel' } }] }));
    expect(await completeAuthorization(new Request(`http://localhost:3000/youtube/callback?state=${state}&code=one-use-code`))).toBe('connected');
    const codeRequest = new URLSearchParams(fetcher.mock.calls[0][1].body);
    expect(codeRequest.get('code_verifier')).toBe(decrypt(verifierEnvelope as Parameters<typeof decrypt>[0], key, `youtube:pkce:${stateDigest}`));
    const saved = vi.mocked(store.youtubeRpc).mock.calls.find(([name]) => name === 'save_youtube_connection')![1];
    expect(JSON.stringify(saved)).not.toContain('private-refresh-token');
    expect(decrypt(saved.encrypted_token as Parameters<typeof decrypt>[0], key, `youtube:refresh:${destination.client_id}:${channel}`)).toBe('private-refresh-token');
    expect(jar.get('pc-youtube-browser')).toBe('');
    await expect(completeAuthorization(new Request(`http://localhost:3000/youtube/callback?state=${state}&code=replay`))).rejects.toMatchObject({ code: 'YOUTUBE_STATE_INVALID' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects a mismatched browser before exchanging any authorization code', async () => {
    await expect(completeAuthorization(new Request('http://localhost:3000/youtube/callback?state=' + 'x'.repeat(43) + '&code=code'))).rejects.toMatchObject({ code: 'YOUTUBE_STATE_INVALID' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('creates and binds a broadcast once, disables both automatic transitions, and never returns an encoder key', async () => {
    remotePreparation();
    const ready = { id: 'local-broadcast', production_id: production.id, youtube_broadcast_id: 'broadcast01', youtube_stream_id: 'stream00001', status: 'READY' };
    let claimed = false;
    vi.mocked(store.youtubeRpc).mockImplementation(async (name, args) => {
      if (name === 'claim_youtube_broadcast') {
        if (claimed) return { ...ready, operation_key: 'original' } as never;
        claimed = true; return { ...ready, status: 'PREPARING', operation_key: args.operation } as never;
      }
      return null as never;
    });
    vi.mocked(store.productionBroadcast).mockResolvedValue(ready as never);
    expect(await prepareYouTube(production.id, input(), staff)).toEqual(ready);
    expect(await prepareYouTube(production.id, input(), staff)).toEqual(ready);
    const insertions = fetcher.mock.calls.filter(([url, init]) => new URL(url).pathname.endsWith('/liveBroadcasts') && init.method === 'POST');
    expect(insertions).toHaveLength(1);
    const body = JSON.parse(insertions[0][1].body as string);
    expect(body.status).toEqual({ privacyStatus: 'private', selfDeclaredMadeForKids: false });
    expect(body.contentDetails).toMatchObject({ enableAutoStart: false, enableAutoStop: false });
    const binding = fetcher.mock.calls.find(([url]) => new URL(url).pathname.endsWith('/bind'))!;
    expect(binding[1].method).toBe('POST'); expect(binding[1].body).toBeUndefined();
    expect(JSON.stringify(ready)).not.toContain('never-return-this-key');
    expect(fetcher.mock.calls.some(([url]) => /transition|delete/.test(url))).toBe(false);
  });
  it('rejects an authorization for another channel before any remote mutation', async () => {
    remotePreparation({ wrongChannel: true });
    await expect(prepareYouTube(production.id, input(), staff)).rejects.toMatchObject({ code: 'YOUTUBE_CHANNEL_MISMATCH' });
    expect(store.youtubeRpc).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.some(([url, init]) => new URL(url).pathname.includes('liveBroadcasts') && init.method === 'POST')).toBe(false);
  });
  it('does not duplicate an in-flight operation and marks uncertain remote requests for reconciliation', async () => {
    remotePreparation({ timeout: true });
    vi.mocked(store.youtubeRpc).mockImplementation(async (name, args) => name === 'claim_youtube_broadcast' ? { id: 'local-broadcast', status: 'PREPARING', operation_key: args.operation } as never : null as never);
    await expect(prepareYouTube(production.id, input(), staff)).rejects.toMatchObject({ code: 'YOUTUBE_UNAVAILABLE' });
    expect(store.youtubeRpc).toHaveBeenCalledWith('checkpoint_youtube_broadcast', expect.objectContaining({ step: 'attention' }));
    vi.mocked(store.youtubeRpc).mockResolvedValue({ id: 'local-broadcast', status: 'NEEDS_ATTENTION', operation_key: 'old-operation' } as never);
    await expect(prepareYouTube(production.id, input(), staff)).rejects.toMatchObject({ code: 'YOUTUBE_RECONCILIATION_REQUIRED' });
    expect(fetcher.mock.calls.filter(([url, init]) => new URL(url).pathname.endsWith('/liveBroadcasts') && init.method === 'POST')).toHaveLength(1);
  });
  it('checks actual YouTube lifecycle status and refuses a changed encoder binding', async () => {
    remotePreparation();
    vi.mocked(store.productionBroadcast).mockResolvedValue({ destination_id: destination.id, youtube_broadcast_id: 'broadcast01', youtube_stream_id: 'different-stream' } as never);
    await expect(checkYouTubeStatus(production.id)).rejects.toMatchObject({ code: 'YOUTUBE_BINDING_CHANGED' });
    vi.mocked(store.productionBroadcast).mockResolvedValue({ destination_id: destination.id, youtube_broadcast_id: 'broadcast01', youtube_stream_id: 'stream00001' } as never);
    expect(await checkYouTubeStatus(production.id)).toMatchObject({ state: 'ready', privacy: 'private' });
  });
  it('reports disabled live streaming, expired consent and quota without exposing provider payloads', async () => {
    for (const [reason, code] of [['liveStreamingNotEnabled','YOUTUBE_LIVE_DISABLED'],['quotaExceeded','YOUTUBE_QUOTA'],['invalid_grant','YOUTUBE_RECONNECT_REQUIRED']]) {
      fetcher.mockResolvedValueOnce(Response.json({ error: { message: 'private secret', errors: [{ reason }] } }, { status: 403 }));
      await expect(google.verifyLiveAccess('token')).rejects.toMatchObject({ code });
    }
    fetcher.mockResolvedValueOnce(Response.json({ error: { message: 'private secret' } }, { status: 400 }));
    await expect(google.verifyLiveAccess('token')).rejects.toThrow('YouTube could not complete the request');
  });
  it('handles declined consent and missing permissions without saving a channel', async () => {
    jar.set('pc-youtube-browser','b'.repeat(43));
    vi.mocked(store.youtubeRpc).mockResolvedValue([{id:'ticket'}] as never);
    expect(await completeAuthorization(new Request('http://localhost:3000/youtube/callback?state='+'s'.repeat(43)+'&error=access_denied'))).toBe('cancelled');
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.youtubeRpc).not.toHaveBeenCalledWith('save_youtube_connection', expect.anything());
    fetcher.mockResolvedValueOnce(ok({access_token:'token',refresh_token:'refresh',scope:'https://www.googleapis.com/auth/youtube.readonly'}));
    await expect(google.exchangeCode('code','verifier')).rejects.toMatchObject({code:'YOUTUBE_CONSENT_REQUIRED'});
  });
  it('halts before remote creation if the channel is disconnected during preparation', async () => {
    remotePreparation(); let lookups=0;
    vi.mocked(get).mockImplementation(async table => (table === 'productions' ? production : ++lookups === 1 ? destination : {...destination,connection_status:'revoked'}) as never);
    vi.mocked(store.youtubeRpc).mockImplementation(async (name,args) => name==='claim_youtube_broadcast' ? {id:'local',status:'PREPARING',operation_key:args.operation} as never : null as never);
    await expect(prepareYouTube(production.id,input(),staff)).rejects.toMatchObject({code:'YOUTUBE_RECONNECT_REQUIRED'});
    expect(fetcher.mock.calls.some(([url,init])=>new URL(url).pathname.endsWith('/liveBroadcasts')&&init.method==='POST')).toBe(false);
    expect(store.youtubeRpc).toHaveBeenCalledWith('checkpoint_youtube_broadcast',expect.objectContaining({step:'attention'}));
  });
  it('does not label a broadcast verified when automatic transition settings differ', async () => {
    remotePreparation();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url,init) => {
      if (new URL(url).searchParams.has('id') && !String(url).includes('/bind')) return ok({items:[{id:'broadcast01',snippet:{channelId:channel},status:{lifeCycleStatus:'ready',privacyStatus:'private'},contentDetails:{boundStreamId:'stream00001',enableAutoStart:true,enableAutoStop:false}}]});
      return original(url,init);
    });
    vi.mocked(store.youtubeRpc).mockImplementation(async (name,args) => name==='claim_youtube_broadcast' ? {id:'local',status:'PREPARING',operation_key:args.operation} as never : null as never);
    await expect(prepareYouTube(production.id,input(),staff)).rejects.toMatchObject({code:'YOUTUBE_VERIFY_FAILED'});
    expect(store.youtubeRpc).not.toHaveBeenCalledWith('checkpoint_youtube_broadcast',expect.objectContaining({step:'ready'}));
  });
  it('requires explicit confirmation, audience, visibility, a future date and real configuration', async () => {
    expect(prepareYouTubeSchema.safeParse({ ...input(), confirmed: false }).success).toBe(false);
    expect(prepareYouTubeSchema.safeParse({ ...input(), made_for_kids: undefined }).success).toBe(false);
    expect(prepareYouTubeSchema.safeParse({ ...input(), privacy: 'unknown' }).success).toBe(false);
    expect(prepareYouTubeSchema.safeParse({ ...input(), scheduled_start_at: '2020-01-01T00:00:00Z' }).success).toBe(false);
    vi.stubEnv('DEMO_MODE', 'true');
    await expect(prepareYouTube(production.id, input(), staff)).rejects.toMatchObject({ code: 'SIMULATION_ONLY' });
    expect(fetcher).not.toHaveBeenCalled();
    vi.stubEnv('DEMO_MODE', 'false');vi.stubEnv('YOUTUBE_CLIENT_SECRET', '');
    expect(google.youtubeConfigured()).toBe(false);
    await expect(beginAuthorization('x'.repeat(43))).rejects.toMatchObject({ code: 'YOUTUBE_SETUP_REQUIRED' });
  });
});
