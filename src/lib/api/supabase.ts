import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** True when the app was built with Supabase env vars. */
export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Supabase client. Only the public anon key ships in the bundle; RLS protects all data.
 * AI / Google secrets live exclusively in Edge Function secrets.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        storage: Platform.OS === 'web' ? undefined : AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === 'web',
        flowType: 'pkce',
      },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured: set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY');
  return supabase;
}

/** Error with a stable code the UI maps to Vietnamese text (vi.errors). */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message?: string,
    readonly status?: number,
  ) {
    super(message ?? code);
    this.name = 'ApiError';
  }
}

/** Unwrap a PostgREST result or throw. */
export function unwrap<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new ApiError(res.error.code ?? 'db_error', res.error.message);
  return res.data as T;
}

export async function currentUserId(): Promise<string> {
  const { data } = await requireSupabase().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new ApiError('unauthorized');
  return id;
}
