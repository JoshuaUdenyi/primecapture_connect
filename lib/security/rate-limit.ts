import { isDemo } from '@/lib/config';
import { demo } from '@/lib/db/demo';
import { adminDb } from '@/lib/db/server';
import { ApiError } from './errors';
import { hash } from './crypto';
export async function rateLimit(subject: string, limit = 30) {
  const key = hash(subject);
  if (isDemo()) {
    const now = Date.now();
    for (const [id, value] of demo.rates) if (value.expires < now) demo.rates.delete(id);
    const entry = demo.rates.get(key) ?? { count: 0, expires: now + 60000 };
    entry.count++; demo.rates.set(key, entry);
    if (entry.count > limit) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again in a minute.');
    return;
  }
  const { data, error } = await adminDb().rpc('consume_rate_limit', { bucket_key: key, max_requests: limit });
  if (error) throw new ApiError(503, 'RATE_LIMIT_UNAVAILABLE', 'Try again later.');
  if (data !== true) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again in a minute.');
}
