import { randomBytes } from 'node:crypto';
import { hash } from './crypto';
// Use the hash + staff/request binding in oauth_states; never store plaintext state.
export const newOAuthState = () => {
  const state = randomBytes(32).toString('base64url');
  return { state, state_hash: hash(state), expires_at: new Date(Date.now() + 600000).toISOString() };
};
export function validState(record: { state_hash: string; expires_at: string; consumed_at: string | null; actor: string }, state: string, actor: string, now = Date.now()) {
  return record.actor === actor && !record.consumed_at && Date.parse(record.expires_at) > now && record.state_hash === hash(state);
}
