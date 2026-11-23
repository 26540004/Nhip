/** Typed calls to Edge Functions. AI keys never leave the server. */
import { onlineManager } from '@tanstack/react-query';
import { ApiError, requireSupabase } from './supabase';
import type { ParsedTask, ParseTaskResponse, TranscriptSummary } from './types';
import { reportFunctionError } from '../errors/reporter';

export async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
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
      reportFunctionError(name, code, ctx.status, error.message);
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

// ---------------------------------------------------------------------------
// Media & note AI
// ---------------------------------------------------------------------------

export interface LinkPreviewDto {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
}

export function linkPreview(url: string): Promise<LinkPreviewDto> {
  return invoke<LinkPreviewDto>('link-preview', { url });
}

export interface TranscribeStatus {
  transcript_status: 'none' | 'processing' | 'done' | 'failed';
  total: number;
  done: number;
  failed: number;
}

export function transcribe(
  attachmentId: string,
  action: 'start' | 'retry' | 'summarize' | 'process',
  segmentId?: string,
): Promise<TranscribeStatus> {
  return invoke<TranscribeStatus>('transcribe-audio', {
    attachment_id: attachmentId,
    action,
    ...(segmentId ? { segment_id: segmentId } : {}),
  });
}

/** "Xoá âm thanh ngay": deletes the audio files, keeps transcript and summary. */
export function deleteAudio(attachmentId: string): Promise<{ audio_deleted_at: string }> {
  return invoke('transcribe-audio', { attachment_id: attachmentId, action: 'delete_audio' });
}

export interface StorageUsage {
  audio: number;
  image: number;
  other: number;
}

export async function storageUsage(): Promise<StorageUsage> {
  const { data, error } = await requireSupabase().rpc('storage_usage');
  if (error) throw error;
  return data as StorageUsage;
}

export function noteSummarize(noteId: string): Promise<{ summary: TranscriptSummary; provider: string }> {
  return invoke('note-ai', { note_id: noteId, action: 'summarize' });
}

export function noteExtractTasks(noteId: string): Promise<{ tasks: ParsedTask[]; provider: string }> {
  return invoke('note-ai', { note_id: noteId, action: 'extract_tasks' });
}

export interface SplitStepDto {
  title: string;
  estimate_minutes: number;
}

export function splitTask(taskId: string): Promise<{ steps: SplitStepDto[]; provider: string }> {
  return invoke('split-task', { task_id: taskId });
}
