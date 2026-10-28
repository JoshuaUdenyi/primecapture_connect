import { completeAuthorization } from '@/lib/youtube/service';
import { youtubeSettings } from '@/lib/youtube/provider';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  let base: string;
  try { base = youtubeSettings().base; }
  catch { return Response.json({ error: 'YouTube connection setup is incomplete.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  let result = 'failed';
  try { result = await completeAuthorization(request); } catch { /* Never return OAuth codes, provider errors or tokens. */ }
  return new Response(null, { status: 303, headers: { Location: new URL(`/youtube/connected?result=${result}`, base).href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
