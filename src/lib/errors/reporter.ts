/**
 * Error reporting for the admin account only ("Claude tự sửa lỗi").
 * Off for everyone else: nothing is captured or sent unless the server says this user is admin
 * AND the admin hasn't turned automatic reports off. Reports are scrubbed again on the server.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { fingerprint, type ReportInput, scrub, scrubRoute } from '../../../supabase/functions/_shared/error-report-core.ts';
import { requireSupabase } from '../api/supabase';

const AUTO_KEY = 'nhip-auto-report';
const MAX_PER_SESSION = 15;

let admin = false;
let auto = true;
let route = '';
let sent = 0;
const seen = new Set<string>();
let installed = false;

export function setReporterAdmin(v: boolean) {
  admin = v;
}
/** Will automatic reports be sent right now (admin + toggle on)? */
export function isReporting(): boolean {
  return admin && auto;
}

export function setReporterRoute(path: string) {
  route = scrubRoute(path);
}
export async function loadAutoReport(): Promise<boolean> {
  try {
    auto = (await AsyncStorage.getItem(AUTO_KEY)) !== '0';
  } catch {
    auto = true;
  }
  return auto;
}
export async function setAutoReport(v: boolean) {
  auto = v;
  try {
    await AsyncStorage.setItem(AUTO_KEY, v ? '1' : '0');
  } catch {
    /* storage unavailable: setting lasts this session */
  }
}

type Report = Omit<ReportInput, 'app_version' | 'platform' | 'os_version' | 'route'> & { route?: string };

/** Send one report. Manual reports always go (admin only); automatic ones respect the toggle. */
export async function report(r: Report, opts: { manual?: boolean } = {}): Promise<{ issue: number | null } | null> {
  if (!admin || (!opts.manual && !auto)) return null;
  const input: ReportInput = {
    ...r,
    message: scrub(r.message || 'Unknown error', 2000),
    route: r.route ?? route,
    app_version: Constants.expoConfig?.version ?? '0',
    platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web',
    os_version: String(Platform.Version ?? '').slice(0, 40),
  };
  if (!opts.manual) {
    const fp = fingerprint(input);
    if (seen.has(fp) || sent >= MAX_PER_SESSION) return null;
    seen.add(fp);
    sent++;
  }
  try {
    const { data, error } = await requireSupabase().functions.invoke<{ issue: number | null }>('report-error', { body: input });
    if (error) return null;
    return data ?? null;
  } catch {
    return null; // never let reporting itself break the app
  }
}

/** Expected, user-facing conditions: not bugs, so never reported. */
const EXPECTED = new Set([
  'offline',
  'network',
  'ai_unavailable',
  'ai_quota',
  'privacy_mode',
  'rate_limited',
  'unauthorized',
  'not_found',
  'not_ready',
]);

export function reportFunctionError(fn: string, code: string, status?: number, message?: string) {
  if (fn === 'report-error' || EXPECTED.has(code) || (status != null && status < 500)) return;
  void report({ kind: 'function', fn, status, message: `${code}${message ? `: ${message}` : ''}` });
}

export function reportException(e: unknown, kind: 'crash' | 'error' = 'error') {
  const err = e instanceof Error ? e : new Error(typeof e === 'string' ? e : 'Non-Error thrown');
  const code = (e as { code?: string })?.code;
  if (code && EXPECTED.has(code)) return;
  if (/Network request failed|Failed to fetch|Load failed|NetworkError/i.test(err.message)) return;
  void report({ kind, message: `${err.name}: ${err.message}`, stack: err.stack });
}

/** Global handlers: uncaught errors and unhandled promise rejections. Installed once. */
export function installGlobalHandlers() {
  if (installed) return;
  installed = true;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.addEventListener('error', (ev) => reportException(ev.error ?? ev.message));
    window.addEventListener('unhandledrejection', (ev) => reportException(ev.reason));
    return;
  }
  const g = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler: () => (e: unknown, fatal?: boolean) => void;
      setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void;
    };
  };
  const prev = g.ErrorUtils?.getGlobalHandler();
  g.ErrorUtils?.setGlobalHandler((e, fatal) => {
    reportException(e, fatal ? 'crash' : 'error');
    prev?.(e, fatal);
  });
}
