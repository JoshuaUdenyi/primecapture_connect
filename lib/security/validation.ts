import { z } from 'zod';
import { ApiError } from './errors';
export const uuid = z.uuid();
export function pageId(reference: string) {
  const value = reference.trim();
  if (/^\d{5,30}$/.test(value)) return value;
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError(400, 'PAGE_ID_REQUIRED', 'Enter a numeric Page ID or a Facebook URL containing a numeric Page ID.'); }
  if (url.protocol !== 'https:' || !['facebook.com', 'www.facebook.com', 'm.facebook.com'].includes(url.hostname) || url.username || url.password || url.port) {
    throw new ApiError(400, 'INVALID_PAGE_REFERENCE', 'Use a Facebook HTTPS Page reference.');
  }
  const candidate = url.pathname === '/profile.php' ? url.searchParams.get('id') : url.pathname.replace(/^\/|\/$/g, '');
  if (!candidate || !/^\d{5,30}$/.test(candidate)) throw new ApiError(400, 'PAGE_ID_REQUIRED', 'Usernames cannot prove identity. Enter the numeric Page ID from Facebook Page transparency.');
  return candidate;
}
export function checkOrigin(request: Request) {
  const expected = new URL(process.env.APP_BASE_URL || request.url).origin;
  if (request.headers.get('origin') !== expected || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ApiError(403, 'CSRF_REJECTED', 'Request origin could not be verified.');
  }
}
export async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Send a JSON request.');
  if (Number(request.headers.get('content-length')) > 8192) throw new ApiError(413, 'TOO_LARGE', 'Request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'INVALID_INPUT', 'Request body is required.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > 8192) { await reader.cancel(); throw new ApiError(413, 'TOO_LARGE', 'Request is too large.'); }
    chunks.push(part.value);
  }
  try { return schema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch { throw new ApiError(400, 'INVALID_INPUT', 'Check the required fields and try again.'); }
}
