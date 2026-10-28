import { z } from 'zod';
import { hash, encrypt, decrypt, type Envelope } from '../../lib/security/crypto';
export type Settings = { streamServiceType: string; streamServiceSettings: Record<string, unknown> };
export interface ObsPort {
  status(): Promise<{ outputActive: boolean }>;
  settings(): Promise<Settings>;
  setSettings(value: Settings): Promise<void>;
  start(): Promise<void>;
}
export type Snapshot = { previous: Envelope; appliedFingerprint: string; productionId: string };
export interface Journal {
  claim(id: string): Promise<boolean>;
  save(snapshot: Snapshot): Promise<void>;
  load(): Promise<Snapshot | null>;
}
const commandSchema = z.object({
  id: z.uuid(), productionId: z.uuid(), issuedAt: z.number(), expiresAt: z.number(),
  action: z.enum(['CONFIGURE_STREAM_WHEN_IDLE','START_STREAM_AFTER_CONFIRMATION','RESTORE_STREAM_WHEN_IDLE']),
  destination: z.object({ server: z.string(), key: z.string().min(1).max(1024) }).strict().optional(),
  confirmed: z.literal(true).optional(), expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type Command = z.infer<typeof commandSchema>;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,val])=>JSON.stringify(key)+':'+canonical(val)).join(',') + '}';
  return JSON.stringify(value);
}
export const fingerprint = (value: Settings) => hash(canonical(value));
export function ingest(server: string, key: string): Settings {
  const url = new URL(server);
  if (url.protocol !== 'rtmps:' || url.hostname !== 'live-api-s.facebook.com' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443') || url.pathname !== '/rtmp/') throw new Error('UNTRUSTED_INGEST');
  return { streamServiceType: 'rtmp_custom', streamServiceSettings: { server: url.href, key, use_auth: false } };
}
/** Offline safety kernel, not connected to the status-only cloud polling loop.
 * Release requires a real authenticated OBS rehearsal + reviewed Meta ingest evidence.
 */
export class SafeObsController {
  private locked = false;
  constructor(private obs: ObsPort, private journal: Journal, private encryptionKey: string, private productionId: string) {}
  private async idle() { if ((await this.obs.status()).outputActive) throw new Error('BLOCKED_OBS_ACTIVE'); }
  async execute(input: unknown) {
    const c = commandSchema.parse(input);
    const now = Date.now();
    if (c.productionId !== this.productionId) throw new Error('PRODUCTION_MISMATCH');
    if (c.expiresAt <= now || c.issuedAt > now || c.expiresAt - c.issuedAt > 30000) throw new Error('EXPIRED_COMMAND');
    if (this.locked) throw new Error('BUSY');
    this.locked = true;
    try {
      // Claim is durable before contacting OBS. Unknown results are never auto-retried.
      if (!(await this.journal.claim(c.id))) throw new Error('REPLAY_REJECTED');
      await this.idle();
      if (c.action === 'CONFIGURE_STREAM_WHEN_IDLE') {
        if (!c.destination) throw new Error('DESTINATION_REQUIRED');
        const target = ingest(c.destination.server,c.destination.key);
        if (await this.journal.load()) throw new Error('SNAPSHOT_PENDING_MANUAL_RECOVERY');
        const previous = await this.obs.settings();
        await this.journal.save({ previous: encrypt(JSON.stringify(previous),this.encryptionKey,this.productionId), appliedFingerprint: fingerprint(target), productionId: this.productionId });
        await this.idle();
        await this.obs.setSettings(target);
        if (fingerprint(await this.obs.settings()) !== fingerprint(target)) throw new Error('READBACK_MISMATCH_MANUAL_RECOVERY_REQUIRED');
        return { status: 'OBS_CONFIGURED', fingerprint: fingerprint(target) };
      }
      const snapshot = await this.journal.load();
      if (!snapshot || snapshot.productionId !== c.productionId) throw new Error('SNAPSHOT_REQUIRED');
      const current = fingerprint(await this.obs.settings());
      if (current !== snapshot.appliedFingerprint) throw new Error('DESTINATION_CHANGED');
      if (c.action === 'RESTORE_STREAM_WHEN_IDLE') {
        const previous: Settings = JSON.parse(decrypt(snapshot.previous,this.encryptionKey,this.productionId));
        await this.idle(); await this.obs.setSettings(previous);
        if (fingerprint(await this.obs.settings()) !== fingerprint(previous)) throw new Error('RESTORE_READBACK_MISMATCH');
        return { status: 'RESTORED' };
      }
      if (!c.confirmed || c.expectedFingerprint !== current) throw new Error('CONFIRMATION_REQUIRED');
      await this.idle(); await this.obs.start();
      return { status: (await this.obs.status()).outputActive ? 'OBS_ACTIVE' : 'UNKNOWN_REMOTE_RESULT' };
    } finally { this.locked = false; }
  }
}
