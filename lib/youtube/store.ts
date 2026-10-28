import 'server-only';
import { adminDb } from '@/lib/db/server';
import { isDemo } from '@/lib/config';
import { ApiError } from '@/lib/security/errors';
import type { Envelope } from '@/lib/security/crypto';
import type { YouTubeBroadcast } from '@/lib/types';

export type OAuthRequest = { id: string; actor: string; client_id: string; state_hash: string; encrypted_verifier: Envelope };
export type ClaimedBroadcast = YouTubeBroadcast & { operation_key: string };
const fields = 'id,production_id,destination_id,youtube_broadcast_id,youtube_stream_id,status,privacy,scheduled_start_at,made_for_kids,created_at';
function databaseError(code?: string) {
  if (['42P01','PGRST202','PGRST205'].includes(code || '')) return new ApiError(503, 'YOUTUBE_MIGRATION_REQUIRED', 'Apply the YouTube database migration in Supabase, then try again.');
  return new ApiError(503, 'YOUTUBE_DATABASE_ERROR', 'The YouTube operation could not be saved. Check YouTube Studio before attempting another production.');
}
export async function youtubeRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await adminDb().rpc(name, args);
  if (error) {
    if (error.message.includes('invalid invitation') || error.message.includes('invalid consent')) throw new ApiError(409, 'YOUTUBE_LINK_EXPIRED', 'This connection link is expired or already used. Ask PrimeCapture for a new link.');
    if (error.message.includes('channel belongs to another client')) throw new ApiError(409, 'YOUTUBE_CLIENT_MISMATCH', 'This channel is already assigned to another client.');
    throw databaseError(error.code);
  }
  return data as T;
}
export async function invitation(inviteHash: string): Promise<{ clientName: string } | null> {
  const { data, error } = await adminDb().from('youtube_oauth_requests').select('client_id').eq('invite_hash', inviteHash).is('invite_used_at', null).is('cancelled_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (error) throw databaseError(error.code);
  if (!data) return null;
  const client = await adminDb().from('clients').select('name').eq('id', data.client_id).single();
  if (client.error) return null;
  return { clientName: client.data.name };
}
export async function listYouTubeBroadcasts(): Promise<YouTubeBroadcast[]> {
  if (isDemo()) return [];
  const { data, error } = await adminDb().from('youtube_broadcasts').select(fields).order('created_at', { ascending: false }).limit(200);
  // Existing workspaces keep working while the additive migration is pending.
  if (error && ['42P01','PGRST205'].includes(error.code)) return [];
  if (error) throw databaseError(error.code);
  return data as YouTubeBroadcast[];
}
export async function productionBroadcast(productionId: string): Promise<YouTubeBroadcast | null> {
  const { data, error } = await adminDb().from('youtube_broadcasts').select(fields).eq('production_id', productionId).maybeSingle();
  if (error) throw databaseError(error.code);
  return data as YouTubeBroadcast | null;
}
export async function refreshEnvelope(destinationId: string): Promise<Envelope> {
  const { data, error } = await adminDb().from('youtube_credentials').select('encrypted_refresh_token').eq('destination_id', destinationId).maybeSingle();
  if (error) throw databaseError(error.code);
  if (!data) throw new ApiError(409, 'YOUTUBE_RECONNECT_REQUIRED', 'Ask the client to connect their YouTube channel again.');
  return data.encrypted_refresh_token as Envelope;
}
