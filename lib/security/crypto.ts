import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
const envelope = z.object({ ciphertext: z.string(), iv: z.string(), tag: z.string(), key_version: z.literal(1) });
export type Envelope = z.infer<typeof envelope>;
function keyBytes(key: string) {
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('Encryption requires a 32-byte hex key');
  return Buffer.from(key, 'hex');
}
export function encrypt(value: string, key: string, context: string): Envelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { ciphertext: encrypted.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), key_version: 1 };
}
export function decrypt(input: Envelope, key: string, context: string): string {
  const value = envelope.parse(input);
  const cipher = createDecipheriv('aes-256-gcm', keyBytes(key), Buffer.from(value.iv, 'base64'));
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([cipher.update(Buffer.from(value.ciphertext, 'base64')), cipher.final()]).toString('utf8');
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
