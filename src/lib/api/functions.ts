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

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface PlanWarningDto {
  kind: 'cannot_fit' | 'partial' | 'overload' | 'dropped' | 'repaired';
  taskId?: string;
  message: string;
}

export interface ProposePlanResult {
  proposal_id: string;
  summary: string;
  notice: string | null;
  source: 'ai' | 'fallback';
  warnings: PlanWarningDto[];
  replaces_block_ids: string[];
}

export function proposePlan(body: {
  range?: 'today' | 'tomorrow' | 'week';
  task_ids?: string[];
  rebalance_date?: string;
}): Promise<ProposePlanResult> {
  return invoke<ProposePlanResult>('propose-plan', body);
}

// ---------------------------------------------------------------------------
// Google Calendar
// ---------------------------------------------------------------------------

export interface GoogleCalendarItem {
  id: string;
  summary: string;
  primary: boolean;
  color: string | null;
  is_target: boolean;
}

export interface SyncResult {
  inserted: number;
  patched: number;
  deleted: number;
  conflicts: number;
  pulledMoved: number;
  pulledDeleted: number;
  busyEvents: number;
}

export function gcalStart(returnTo: string): Promise<{ url: string }> {
  return invoke('gcal-auth', { action: 'start', return_to: returnTo });
}

export function gcalCalendars(): Promise<{ calendars: GoogleCalendarItem[] }> {
  return invoke('gcal-auth', { action: 'calendars' });
}

export function gcalDisconnect(): Promise<{ ok: true }> {
  return invoke('gcal-auth', { action: 'disconnect' });
}

export function gcalSync(): Promise<SyncResult> {
  return invoke('gcal-sync', {});
}
