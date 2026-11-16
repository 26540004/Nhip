/**
 * Sign in with Apple (native sheet on iOS) or Google (OAuth via Supabase, PKCE).
 * Web uses Supabase's redirect flow for both providers.
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import { makeRedirectUri } from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { ApiError, requireSupabase } from '../../lib/api/supabase';

WebBrowser.maybeCompleteAuthSession();

export const authRedirectUri = (): string => makeRedirectUri({ scheme: 'nhip', path: 'auth/callback' });

export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return true; // via OAuth redirect
  if (Platform.OS !== 'ios') return false;
  return AppleAuthentication.isAvailableAsync();
}

export async function signInWithApple(): Promise<void> {
  const db = requireSupabase();
  if (Platform.OS !== 'ios') {
    await signInWithOAuth('apple');
    return;
  }
  // Nonce: Apple receives the SHA-256, Supabase verifies against the raw value.
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) throw new ApiError('auth_failed');
    const { error } = await db.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken, nonce: rawNonce });
    if (error) throw new ApiError('auth_failed', error.message);
    // Apple only returns the name on first sign-in: save it.
    const name = credential.fullName ? AppleAuthentication.formatFullName(credential.fullName) : '';
    if (name.trim()) await db.auth.updateUser({ data: { full_name: name.trim() } });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new ApiError('auth_cancelled');
    throw e;
  }
}

export async function signInWithGoogle(): Promise<void> {
  await signInWithOAuth('google');
}

async function signInWithOAuth(provider: 'google' | 'apple'): Promise<void> {
  const db = requireSupabase();
  if (Platform.OS === 'web') {
    const { error } = await db.auth.signInWithOAuth({
      provider,
      options: { redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined },
    });
    if (error) throw new ApiError('auth_failed', error.message);
    return; // browser navigates away
  }
  const redirectTo = authRedirectUri();
  const { data, error } = await db.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } });
  if (error || !data.url) throw new ApiError('auth_failed', error?.message);
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') throw new ApiError('auth_cancelled');
  const code = new URL(result.url).searchParams.get('code');
  if (!code) throw new ApiError('auth_failed', 'missing code');
  const { error: exErr } = await db.auth.exchangeCodeForSession(code);
  if (exErr) throw new ApiError('auth_failed', exErr.message);
}
