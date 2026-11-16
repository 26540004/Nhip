/** Typed calls to Edge Functions. AI keys never leave the server. */
import { onlineManager } from '@tanstack/react-query';
import { ApiError, requireSupabase } from './supabase';
import type { ParseTaskResponse } from './types';

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!onlineManager.isOnline()) throw new ApiError('offline');
  const { data, error } = await requireSupabase().functions.invoke<T>(name, { body });
  if (error) {
    // FunctionsHttpError carries the Response in `context`.
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      let code = 'internal';
      try {
        const j = (await ctx.json()) as { error?: string };
        if (j.error) code = j.error;
      } catch {
        /* non-JSON body */
      }
      throw new ApiError(code, error.message, ctx.status);
    }
    throw new ApiError('network', error.message);
  }
  if (data == null) throw new ApiError('internal', 'empty response');
  return data;
}

export function parseTask(text: string): Promise<ParseTaskResponse> {
  return invoke<ParseTaskResponse>('parse-task', { text, client_now: new Date().toISOString() });
}
