import 'server-only';
import { z } from 'zod';
import { ApiError } from '@/lib/security/errors';

export const youtubeScope = 'https://www.googleapis.com/auth/youtube.force-ssl';
const remoteId = z.string().regex(/^[A-Za-z0-9_-]{6,128}$/);
const channelSchema = z.object({ id: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/), snippet: z.object({ title: z.string().min(1) }) });
const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1).optional(), scope: z.string().optional() });
export function youtubeConfigured() {
  return Boolean(process.env.YOUTUBE_CLIENT_ID?.trim() && process.env.YOUTUBE_CLIENT_SECRET?.trim() && /^[a-f\d]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY || '') && process.env.APP_BASE_URL?.trim());
}
export function youtubeSettings() {
  if (!youtubeConfigured()) throw new ApiError(503, 'YOUTUBE_SETUP_REQUIRED', 'Your administrator needs to finish Google OAuth and YouTube setup. See docs/youtube-setup.md in the project.');
  const base = new URL(process.env.APP_BASE_URL!);
  if (base.username || base.password || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname)))) throw new ApiError(503, 'YOUTUBE_SETUP_REQUIRED', 'YouTube requires an HTTPS application URL, or localhost for local testing.');
  return { clientId: process.env.YOUTUBE_CLIENT_ID!, clientSecret: process.env.YOUTUBE_CLIENT_SECRET!, key: process.env.TOKEN_ENCRYPTION_KEY!, base: base.origin, redirect: new URL('/youtube/callback', base.origin).href };
}
async function json(url: string, init: RequestInit) {
  let response: Response;
  try { response = await fetch(url, { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch { throw new ApiError(502, 'YOUTUBE_UNAVAILABLE', 'YouTube did not confirm the request. Check YouTube Studio before trying another production.'); }
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new ApiError(502, 'YOUTUBE_UNAVAILABLE', 'YouTube returned an unreadable response. Check YouTube Studio.'); }
  if (!response.ok) {
    const parsed = z.object({ error: z.union([z.string(), z.object({ errors: z.array(z.object({ reason: z.string() })).optional() })]).optional() }).safeParse(payload);
    const error = parsed.success ? parsed.data.error : undefined;
    const reason = typeof error === 'string' ? error : error?.errors?.[0]?.reason;
    if (reason === 'liveStreamingNotEnabled') throw new ApiError(409, 'YOUTUBE_LIVE_DISABLED', 'The client must enable live streaming in YouTube Studio. First-time activation can take up to 24 hours.');
    if (reason === 'livePermissionBlocked' || reason === 'insufficientLivePermissions') throw new ApiError(403, 'YOUTUBE_LIVE_RESTRICTED', 'YouTube has restricted live streaming for this channel. The channel owner must review YouTube Studio.');
    if (reason === 'invalid_grant' || response.status === 401) throw new ApiError(409, 'YOUTUBE_RECONNECT_REQUIRED', 'YouTube access has expired or been revoked. Ask the client to reconnect their channel.');
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') throw new ApiError(429, 'YOUTUBE_QUOTA', 'The Google project has reached its YouTube API quota. Try later.');
    throw new ApiError(502, 'YOUTUBE_REJECTED', 'YouTube could not complete the request. Check channel permissions and the Google project configuration.');
  }
  return payload;
}
export function authorizationUrl(state: string, challenge: string) {
  const config = youtubeSettings();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirect, response_type: 'code', scope: youtubeScope, access_type: 'offline', prompt: 'consent select_account', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
  return url.href;
}
export async function exchangeCode(code: string, verifier: string) {
  const config = youtubeSettings();
  const tokens = tokenSchema.parse(await json('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, code_verifier: verifier, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirect, grant_type: 'authorization_code' }) }));
  if (!tokens.refresh_token || !tokens.scope?.split(' ').includes(youtubeScope)) throw new ApiError(409, 'YOUTUBE_CONSENT_REQUIRED', 'Grant the requested YouTube permission and reconnect the channel.');
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
}
export async function refreshAccess(refreshToken: string) {
  const config = youtubeSettings();
  const tokens = tokenSchema.parse(await json('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token' }) }));
  return tokens.access_token;
}
async function api(resource: string, token: string, query: Record<string, string>, value?: unknown, method = value === undefined ? 'GET' : 'POST') {
  const url = new URL(resource, 'https://www.googleapis.com/youtube/v3/');
  url.search = new URLSearchParams(query).toString();
  return json(url.href, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
export async function ownChannel(token: string) {
  const result = z.object({ items: z.array(channelSchema) }).parse(await api('channels', token, { part: 'id,snippet', mine: 'true', maxResults: '2' }));
  if (result.items.length !== 1) throw new ApiError(409, 'YOUTUBE_CHANNEL_REQUIRED', 'Choose the Google or Brand Account for one YouTube channel, then reconnect.');
  return { id: result.items[0].id, title: result.items[0].snippet.title.slice(0, 120) };
}
export async function verifyLiveAccess(token: string) {
  await api('liveBroadcasts', token, { part: 'id', mine: 'true', maxResults: '1' });
}
export async function insertBroadcast(token: string, input: { title: string; scheduled_start_at: string; privacy: string; made_for_kids: boolean }) {
  return z.object({ id: remoteId }).parse(await api('liveBroadcasts', token, { part: 'id,snippet,status,contentDetails' }, {
    snippet: { title: input.title.slice(0, 100), scheduledStartTime: input.scheduled_start_at },
    status: { privacyStatus: input.privacy, selfDeclaredMadeForKids: input.made_for_kids },
    contentDetails: { enableAutoStart: false, enableAutoStop: false, monitorStream: { enableMonitorStream: true, broadcastStreamDelayMs: 0 } },
  })).id;
}
export async function insertStream(token: string, title: string) {
  // Deliberately discard ingestionInfo (including the stream key). Operators use YouTube Studio.
  return z.object({ id: remoteId }).parse(await api('liveStreams', token, { part: 'id,snippet,cdn,contentDetails' }, {
    snippet: { title: title.slice(0, 100) }, cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable' }, contentDetails: { isReusable: false },
  })).id;
}
export async function bindStream(token: string, broadcastId: string, streamId: string) {
  const result = z.object({ id: remoteId, contentDetails: z.object({ boundStreamId: remoteId }) }).parse(await api('liveBroadcasts/bind', token, { part: 'id,contentDetails', id: broadcastId, streamId }, undefined, 'POST'));
  if (result.id !== broadcastId || result.contentDetails.boundStreamId !== streamId) throw new ApiError(502, 'YOUTUBE_BIND_FAILED', 'YouTube did not confirm the selected stream binding. Check YouTube Studio.');
}
export async function broadcastStatus(token: string, broadcastId: string, channelId: string) {
  const result = z.object({ items: z.array(z.object({ id: remoteId, snippet: z.object({ channelId: z.string() }), status: z.object({ lifeCycleStatus: z.string(), privacyStatus: z.string() }), contentDetails: z.object({ boundStreamId: remoteId.optional(), enableAutoStart: z.boolean().optional(), enableAutoStop: z.boolean().optional() }) })) }).parse(await api('liveBroadcasts', token, { part: 'id,snippet,status,contentDetails', id: broadcastId }));
  const item = result.items[0];
  if (!item || item.id !== broadcastId || item.snippet.channelId !== channelId) throw new ApiError(409, 'YOUTUBE_BROADCAST_MISMATCH', 'This broadcast could not be verified on the connected channel.');
  return { state: item.status.lifeCycleStatus, privacy: item.status.privacyStatus, streamId: item.contentDetails.boundStreamId, autoStart: item.contentDetails.enableAutoStart, autoStop: item.contentDetails.enableAutoStop };
}
