import 'server-only';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { isDemo } from '@/lib/config';
import { get } from '@/lib/db/repository';
import { encrypt, decrypt, hash } from '@/lib/security/crypto';
import { ApiError } from '@/lib/security/errors';
import { rateLimit } from '@/lib/security/rate-limit';
import type { Destination, Staff } from '@/lib/types';
import * as google from './provider';
import * as store from './store';
const opaque = /^[A-Za-z0-9_-]{43}$/;
export const prepareYouTubeSchema = z.object({
  scheduled_start_at: z.iso.datetime().refine(value => Date.parse(value) > Date.now() + 30000 && Date.parse(value) < Date.now() + 365 * 86400000, 'Choose a future date within one year.'),
  privacy: z.enum(['private','unlisted','public']), made_for_kids: z.boolean(), confirmed: z.literal(true),
}).strict();
export type PrepareYouTubeInput = z.infer<typeof prepareYouTubeSchema>;
function realWorkspace() {
  if (isDemo()) throw new ApiError(409, 'SIMULATION_ONLY', 'YouTube API requests are disabled in this sample workspace. Use the real staff workspace to connect a channel and create broadcasts.');
  return google.youtubeSettings();
}
export async function createConnectionLink(clientId: string, staff: Staff) {
  const config = realWorkspace();
  await get('clients', clientId);
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 86400000).toISOString();
  await store.youtubeRpc('create_youtube_invite', { ticket_id: randomUUID(), ticket_hash: hash(token), client: clientId, actor: staff.user_id, expiry: expiresAt });
  return { connect_url: `${config.base}/youtube/connect?invite=${token}`, expires_at: expiresAt };
}
export async function beginAuthorization(invite: string) {
  const config = realWorkspace();
  if (!opaque.test(invite)) throw new ApiError(400, 'YOUTUBE_LINK_INVALID', 'This connection link is invalid.');
  await rateLimit('youtube-oauth-global', 30);
  await rateLimit('youtube-oauth:' + hash(invite), 3);
  const state = randomBytes(32).toString('base64url'), browser = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  const stateHash = hash(state);
  await store.youtubeRpc('begin_youtube_oauth', { ticket_hash: hash(invite), state_digest: stateHash, browser_digest: hash(browser), verifier: encrypt(verifier, config.key, `youtube:pkce:${stateHash}`) });
  (await cookies()).set('pc-youtube-browser', browser, { httpOnly: true, secure: config.base.startsWith('https:'), sameSite: 'lax', path: '/youtube/callback', maxAge: 600 });
  return { authorization_url: google.authorizationUrl(state, createHash('sha256').update(verifier).digest('base64url')) };
}
export async function completeAuthorization(request: Request) {
  const config = realWorkspace();
  const params = new URL(request.url).searchParams;
  const state = params.get('state') || '', code = params.get('code');
  const jar = await cookies(), browser = jar.get('pc-youtube-browser')?.value || '';
  if (!opaque.test(state) || !opaque.test(browser)) throw new ApiError(400, 'YOUTUBE_STATE_INVALID', 'Connection verification failed. Request a new link.');
  const records = await store.youtubeRpc<store.OAuthRequest[]>('claim_youtube_oauth', { state_digest: hash(state), browser_digest: hash(browser) });
  // Delete with the same path used when setting the binding cookie.
  jar.set('pc-youtube-browser', '', { httpOnly: true, secure: config.base.startsWith('https:'), sameSite: 'lax', path: '/youtube/callback', maxAge: 0 });
  if (records.length !== 1) throw new ApiError(409, 'YOUTUBE_STATE_INVALID', 'This authorization has expired or was already used.');
  if (params.has('error')) return 'cancelled';
  if (!code || code.length > 4096) throw new ApiError(400, 'YOUTUBE_CODE_INVALID', 'Google did not return an authorization code.');
  const ticket = records[0];
  const tokens = await google.exchangeCode(code, decrypt(ticket.encrypted_verifier, config.key, `youtube:pkce:${hash(state)}`));
  const channel = await google.ownChannel(tokens.accessToken);
  await store.youtubeRpc('save_youtube_connection', { ticket_id: ticket.id, new_destination: randomUUID(), channel_id: channel.id, channel_title: channel.title,
    encrypted_token: encrypt(tokens.refreshToken, config.key, `youtube:refresh:${ticket.client_id}:${channel.id}`) });
  return 'connected';
}
async function channelAccess(destination: Destination) {
  const config = realWorkspace();
  if (destination.provider !== 'youtube' || ['revoked','expired'].includes(destination.connection_status)) throw new ApiError(409, 'YOUTUBE_RECONNECT_REQUIRED', 'Connect this client’s YouTube channel before creating a broadcast.');
  const refresh = decrypt(await store.refreshEnvelope(destination.id), config.key, `youtube:refresh:${destination.client_id}:${destination.external_id}`);
  const token = await google.refreshAccess(refresh);
  const channel = await google.ownChannel(token);
  if (channel.id !== destination.external_id) throw new ApiError(409, 'YOUTUBE_CHANNEL_MISMATCH', 'Google returned a different channel. Ask the client to reconnect the correct channel.');
  return token;
}
async function ensureConnected(id: string) {
  const destination = await get('destinations', id);
  if (['revoked','expired'].includes(destination.connection_status)) throw new ApiError(409, 'YOUTUBE_RECONNECT_REQUIRED', 'This channel has been disconnected.');
  await store.refreshEnvelope(id);
}
export async function prepareYouTube(productionId: string, input: PrepareYouTubeInput, staff: Staff) {
  realWorkspace();
  const production = await get('productions', productionId);
  if (!production.destination_id) throw new ApiError(409, 'DESTINATION_REQUIRED', 'Choose the client’s connected YouTube channel.');
  const destination = await get('destinations', production.destination_id);
  const token = await channelAccess(destination);
  await google.verifyLiveAccess(token);
  const operation = randomUUID();
  const claimed = await store.youtubeRpc<store.ClaimedBroadcast>('claim_youtube_broadcast', { production: production.id, actor: staff.user_id, start_time: input.scheduled_start_at, visibility: input.privacy, kids: input.made_for_kids, operation });
  if (claimed.status === 'READY') return (await store.productionBroadcast(productionId))!;
  if (claimed.operation_key !== operation || claimed.status !== 'PREPARING') throw new ApiError(409, 'YOUTUBE_RECONCILIATION_REQUIRED', 'This production already has a pending or incomplete YouTube request. Check YouTube Studio before creating anything else.');
  const checkpoint = (step: string, remoteId?: string) => store.youtubeRpc('checkpoint_youtube_broadcast', { broadcast: claimed.id, actor: staff.user_id, step, remote_id: remoteId || null });
  try {
    await ensureConnected(destination.id);
    const broadcastId = await google.insertBroadcast(token, { ...input, title: production.title });
    await checkpoint('broadcast', broadcastId);
    await ensureConnected(destination.id);
    const streamId = await google.insertStream(token, production.title);
    await checkpoint('stream', streamId);
    await ensureConnected(destination.id);
    await google.bindStream(token, broadcastId, streamId);
    const verified = await google.broadcastStatus(token, broadcastId, destination.external_id);
    if (verified.streamId !== streamId || !['created','ready'].includes(verified.state) || verified.privacy !== input.privacy || verified.autoStart !== false || verified.autoStop !== false) throw new ApiError(409, 'YOUTUBE_VERIFY_FAILED', 'Review the broadcast, visibility, stream binding and auto-start/stop settings in YouTube Studio.');
    await checkpoint('ready');
    return (await store.productionBroadcast(productionId))!;
  } catch (error) {
    // A timed-out POST may have succeeded remotely. Never retry or delete it automatically.
    await checkpoint('attention').catch(() => {});
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'YOUTUBE_RECONCILIATION_REQUIRED', 'The broadcast could not be fully verified. Check YouTube Studio; no automatic retry was made.');
  }
}
export async function checkYouTubeStatus(productionId: string) {
  realWorkspace();
  const production = await get('productions', productionId);
  const broadcast = await store.productionBroadcast(productionId);
  if (!broadcast?.youtube_broadcast_id || production.destination_id !== broadcast.destination_id) throw new ApiError(409, 'YOUTUBE_BROADCAST_REQUIRED', 'Create a YouTube broadcast for this production first.');
  const destination = await get('destinations', broadcast.destination_id);
  const token = await channelAccess(destination);
  const status = await google.broadcastStatus(token, broadcast.youtube_broadcast_id, destination.external_id);
  if (broadcast.youtube_stream_id && status.streamId !== broadcast.youtube_stream_id) throw new ApiError(409, 'YOUTUBE_BINDING_CHANGED', 'The stream binding has changed in YouTube Studio. Review it before streaming.');
  if (status.autoStart !== false || status.autoStop !== false) throw new ApiError(409, 'YOUTUBE_SETTINGS_CHANGED', 'Auto-start or auto-stop settings could not be verified as off. Review YouTube Studio.');
  return { state: status.state, privacy: status.privacy, checked_at: new Date().toISOString() };
}
