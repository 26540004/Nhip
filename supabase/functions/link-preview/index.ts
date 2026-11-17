/**
 * link-preview — Open Graph card data for a URL pasted into a note or task.
 *
 * POST { url } with the user's JWT →
 *   200 { url, title, description, image, site_name }
 *   400 bad_request · 401 unauthorized · 422 blocked (private/unsupported address) · 502 fetch failed
 * See _shared/link-preview-core.ts for the SSRF, size and timeout limits.
 */
import { z } from 'zod';
import { getUser } from '../_shared/context.ts';
import { corsHeaders, errorResponse, json, log } from '../_shared/http.ts';
import { fetchPreview, PreviewError } from '../_shared/link-preview-core.ts';

const FN = 'link-preview';
const Body = z.object({ url: z.string().trim().min(4).max(2000) });

async function resolveHost(host: string): Promise<string[]> {
  const out: string[] = [];
  for (const type of ['A', 'AAAA'] as const) {
    try {
      out.push(...(await Deno.resolveDns(host, type)));
    } catch {
      /* no record of this type */
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('bad_request', 405);
  const auth = await getUser(req);
  if (!auth) return errorResponse('unauthorized', 401);

  let url: string;
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return errorResponse('bad_request', 400);
    url = parsed.data.url;
  } catch {
    return errorResponse('bad_request', 400, 'invalid JSON');
  }

  const started = Date.now();
  try {
    const preview = await fetchPreview(url, { fetchFn: fetch, resolveHost, timeoutMs: 5000 });
    log(FN, { event: 'done', ms: Date.now() - started, has_image: Boolean(preview.image) });
    return json(preview);
  } catch (e) {
    const code = e instanceof PreviewError ? e.code : 'network';
    log(FN, { event: 'failed', code, ms: Date.now() - started });
    if (code === 'blocked') return errorResponse('link_blocked', 422);
    return errorResponse('link_failed', 502, code);
  }
});
