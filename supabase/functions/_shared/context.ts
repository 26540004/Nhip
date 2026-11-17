/**
 * Deno-only: environment, Supabase clients, auth and the AI provider chain.
 * Secrets come from `supabase secrets set` and never reach the client bundle.
 */
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { type AIProvider, GeminiProvider, GroqProvider } from './ai-provider.ts';
import { WhisperTranscriber } from './transcribe-core.ts';

export function env(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v && v.trim() ? v.trim() : undefined;
}

export function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export function serviceClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Client acting as the caller (RLS applies). */
export function userClient(req: Request): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getUser(req: Request): Promise<{ user: User; db: SupabaseClient } | null> {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const db = userClient(req);
  const { data, error } = await db.auth.getUser(auth.slice(7));
  if (error || !data.user) return null;
  return { user: data.user, db };
}

/** True when the request carries the service role key (pg_cron jobs). */
export function isServiceCall(req: Request): boolean {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return Boolean(key) && req.headers.get('Authorization') === `Bearer ${key}`;
}

/** Gemini first, Groq second; model ids only from env. */
export function aiProviders(): AIProvider[] {
  const list: AIProvider[] = [];
  const gKey = env('GEMINI_API_KEY');
  const gModel = env('GEMINI_MODEL');
  if (gKey && gModel) list.push(new GeminiProvider(gKey, gModel, fetch, env('GEMINI_BASE_URL')));
  const qKey = env('GROQ_API_KEY');
  const qModel = env('GROQ_MODEL');
  if (qKey && qModel) list.push(new GroqProvider(qKey, qModel, fetch, env('GROQ_BASE_URL')));
  return list;
}

/** Groq Whisper speech-to-text, the transcription fallback (model id only from env). */
export function speechToText(): WhisperTranscriber | null {
  const key = env('GROQ_API_KEY');
  const model = env('GROQ_STT_MODEL');
  return key && model ? new WhisperTranscriber(key, model, fetch, env('GROQ_BASE_URL')) : null;
}

export function dailyAiLimit(): number {
  const n = Number(env('AI_DAILY_CALL_LIMIT') ?? '200');
  return Number.isFinite(n) && n > 0 ? n : 200;
}

/** Atomically count one AI call for the user; false when the daily limit is reached. */
export async function consumeAiCall(userId: string): Promise<boolean> {
  const { data, error } = await serviceClient().rpc('consume_ai_call', { p_user: userId, p_limit: dailyAiLimit() });
  if (error) throw error;
  return data === true;
}
