/** HTTP helpers for Edge Functions (CORS, JSON responses, typed errors). */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Error codes the client maps to Vietnamese messages (src/i18n/vi.ts → errors). */
export type ErrorCode = 'unauthorized' | 'bad_request' | 'ai_unavailable' | 'ai_quota' | 'privacy_mode' | 'not_found' | 'internal';

export function errorResponse(code: ErrorCode, status: number, detail?: string): Response {
  return json({ error: code, ...(detail ? { detail } : {}) }, status);
}

/** Structured log line without user content. */
export function log(fn: string, event: Record<string, unknown>): void {
  console.log(JSON.stringify({ fn, ts: new Date().toISOString(), ...event }));
}
