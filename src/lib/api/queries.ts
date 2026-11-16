/**
 * Typed reads (TanStack Query). Results are persisted to AsyncStorage so Today, Tasks and
 * Notes stay readable offline.
 */
import { useQuery } from '@tanstack/react-query';
import { requireSupabase, unwrap } from './supabase';
import type {
  Attachment,
  BusyRow,
  CapacityRow,
  ClassSessionRow,
  Collection,
  Note,
  Profile,
  ScheduleExceptionRow,
  SearchHit,
  StudyWindowRow,
  Task,
  TaskBlock,
  WorkHoursRow,
} from './types';

export const qk = {
  tasks: ['tasks'] as const,
  notes: ['notes'] as const,
  note: (id: string) => ['note', id] as const,
  collections: ['collections'] as const,
  settings: ['settings'] as const,
  blocks: (from: string, to: string) => ['blocks', from, to] as const,
  busy: (from: string, to: string) => ['busy', from, to] as const,
  search: (q: string) => ['search', q] as const,
  profile: ['profile'] as const,
  taskBlocks: (taskId: string) => ['taskBlocks', taskId] as const,
  links: (ownerId: string) => ['links', ownerId] as const,
  google: ['google'] as const,
  proposal: (id: string) => ['proposal', id] as const,
  proposedBlocks: (from: string, to: string) => ['proposedBlocks', from, to] as const,
};

const TASK_COLUMNS =
  'id, user_id, space, collection_id, parent_task_id, title, description, deadline_at, estimate_minutes, priority, priority_reason, status, source, source_note_id, needs_parse, sort_order, completed_at, actual_minutes, created_at, updated_at';

/** All open tasks + tasks completed/dropped in the last 30 days. */
export async function fetchTasks(): Promise<Task[]> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const db = requireSupabase();
  return unwrap(
    await db
      .from('tasks')
      .select(TASK_COLUMNS)
      .or(`status.in.(todo,doing),updated_at.gte.${since}`)
      .order('deadline_at', { ascending: true, nullsFirst: false })
      .order('sort_order')
      .limit(2000),
  ) as Task[];
}

export function useTasks() {
  return useQuery({ queryKey: qk.tasks, queryFn: fetchTasks });
}

const NOTE_LIST_COLUMNS = 'id, user_id, space, collection_id, title, plain_text, pinned, created_at, updated_at';

export type NoteListItem = Omit<Note, 'content_json'> & { attachment_types?: string[] };

export async function fetchNotes(): Promise<NoteListItem[]> {
  const db = requireSupabase();
  const notes = unwrap(
    await db
      .from('notes')
      .select(NOTE_LIST_COLUMNS)
      .order('pinned', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(1000),
  ) as Omit<Note, 'content_json'>[];
  // Attachment type icons (📷 🔗 🎙) for list cards.
  const atts = unwrap(await db.from('attachments').select('owner_id, type').eq('owner_type', 'note')) as {
    owner_id: string;
    type: string;
  }[];
  const byNote = new Map<string, Set<string>>();
  for (const a of atts) {
    const set = byNote.get(a.owner_id) ?? new Set<string>();
    set.add(a.type);
    byNote.set(a.owner_id, set);
  }
  return notes.map((n) => ({ ...n, attachment_types: [...(byNote.get(n.id) ?? [])] }));
}

export function useNotes() {
  return useQuery({ queryKey: qk.notes, queryFn: fetchNotes });
}

export function useNote(id: string | undefined) {
  return useQuery({
    queryKey: qk.note(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => unwrap(await requireSupabase().from('notes').select('*').eq('id', id!).maybeSingle()) as Note | null,
  });
}

export function useCollections() {
  return useQuery({
    queryKey: qk.collections,
    queryFn: async () => unwrap(await requireSupabase().from('collections').select('*').order('name')) as Collection[],
  });
}

export interface SettingsBundle {
  profile: Profile | null;
  workHours: WorkHoursRow[];
  studyWindows: StudyWindowRow[];
  classSessions: ClassSessionRow[];
  exceptions: ScheduleExceptionRow[];
  capacity: CapacityRow[];
  reminders: {
    morning_brief_time: string;
    evening_review_time: string;
    morning_brief_enabled: boolean;
    evening_review_enabled: boolean;
    deadline_offsets_minutes: number[];
    start_offset_minutes: number;
    quiet_start: string | null;
    quiet_end: string | null;
  } | null;
}

export async function fetchSettings(): Promise<SettingsBundle> {
  const db = requireSupabase();
  const [profile, workHours, studyWindows, classSessions, exceptions, capacity, reminders] = await Promise.all([
    db
      .from('profiles')
      .select('id, display_name, timezone, ai_privacy_mode, daily_ai_calls, daily_ai_calls_date, onboarding_completed_at')
      .maybeSingle(),
    db.from('work_hours').select('weekday, start_time, end_time, break_start, break_end, enabled').order('weekday'),
    db.from('study_windows').select('id, weekday, start_time, end_time').order('weekday'),
    db.from('class_sessions').select('id, collection_id, weekday, start_time, end_time, location, valid_from, valid_to'),
    db.from('schedule_exceptions').select('id, class_session_id, date, type, new_start_at, new_end_at'),
    db.from('capacity_settings').select('space, weekday, max_focus_minutes'),
    db
      .from('reminder_settings')
      .select(
        'morning_brief_time, evening_review_time, morning_brief_enabled, evening_review_enabled, deadline_offsets_minutes, start_offset_minutes, quiet_start, quiet_end',
      )
      .maybeSingle(),
  ]);
  return {
    profile: unwrap(profile) as Profile | null,
    workHours: unwrap(workHours) as WorkHoursRow[],
    studyWindows: unwrap(studyWindows) as StudyWindowRow[],
    classSessions: unwrap(classSessions) as ClassSessionRow[],
    exceptions: unwrap(exceptions) as ScheduleExceptionRow[],
    capacity: unwrap(capacity) as CapacityRow[],
    reminders: unwrap(reminders) as SettingsBundle['reminders'],
  };
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: fetchSettings, staleTime: 5 * 60_000 });
}

/** Accepted / synced / conflict blocks overlapping [from, to). */
export function useBlocks(from: string, to: string) {
  return useQuery({
    queryKey: qk.blocks(from, to),
    queryFn: async () =>
      unwrap(
        await requireSupabase()
          .from('task_blocks')
          .select('id, user_id, task_id, start_at, end_at, status, proposal_id, reason, gcal_event_id, last_synced_at')
          .in('status', ['accepted', 'synced', 'conflict'])
          .lt('start_at', to)
          .gt('end_at', from)
          .order('start_at'),
      ) as TaskBlock[],
  });
}

export function useBusy(from: string, to: string) {
  return useQuery({
    queryKey: qk.busy(from, to),
    queryFn: async () =>
      unwrap(
        await requireSupabase()
          .from('busy_cache')
          .select('id, source_calendar_id, start_at, end_at, title, all_day')
          .lt('start_at', to)
          .gt('end_at', from)
          .order('start_at'),
      ) as BusyRow[],
  });
}

export function useSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: qk.search(term),
    enabled: term.length >= 2,
    staleTime: 10_000,
    queryFn: async () => unwrap(await requireSupabase().rpc('search_all', { q: term, max_results: 40 })) as SearchHit[],
  });
}

export function useTaskBlocks(taskId: string | undefined) {
  return useQuery({
    queryKey: qk.taskBlocks(taskId ?? ''),
    enabled: Boolean(taskId),
    queryFn: async () =>
      unwrap(
        await requireSupabase()
          .from('task_blocks')
          .select('id, user_id, task_id, start_at, end_at, status, proposal_id, reason, gcal_event_id, last_synced_at')
          .eq('task_id', taskId!)
          .neq('status', 'rejected')
          .order('start_at'),
      ) as TaskBlock[],
  });
}

/** Link attachments of a task or note. */
export function useLinks(ownerId: string | undefined) {
  return useQuery({
    queryKey: qk.links(ownerId ?? ''),
    enabled: Boolean(ownerId),
    queryFn: async () =>
      unwrap(
        await requireSupabase()
          .from('attachments')
          .select('id, owner_type, owner_id, type, storage_path, url, title, meta_json, created_at')
          .eq('owner_id', ownerId!)
          .eq('type', 'link')
          .order('created_at'),
      ) as Attachment[],
  });
}

export interface GoogleConnection {
  google_email: string | null;
  read_calendar_ids: string[];
  target_calendar_id: string | null;
  status: 'disconnected' | 'connected' | 'syncing' | 'error' | 'revoked';
  last_error: string | null;
  last_synced_at: string | null;
}

export function useGoogleConnection() {
  return useQuery({
    queryKey: qk.google,
    queryFn: async () =>
      unwrap(
        await requireSupabase()
          .from('google_connections')
          .select('google_email, read_calendar_ids, target_calendar_id, status, last_error, last_synced_at')
          .maybeSingle(),
      ) as GoogleConnection | null,
  });
}

export interface Proposal {
  id: string;
  range_start: string;
  range_end: string;
  status: 'pending' | 'reviewed' | 'applied';
  request_context_json: { replaces_block_ids?: string[]; privacy_mode?: boolean };
  validation_report_json: {
    source: 'ai' | 'fallback';
    summary: string;
    notice: string | null;
    warnings: { kind: string; taskId?: string; message: string }[];
  } | null;
  created_at: string;
}

export function useProposal(id: string | undefined) {
  return useQuery({
    queryKey: qk.proposal(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => {
      const db = requireSupabase();
      const [p, b] = await Promise.all([
        db
          .from('ai_proposals')
          .select('id, range_start, range_end, status, request_context_json, validation_report_json, created_at')
          .eq('id', id!)
          .maybeSingle(),
        db
          .from('task_blocks')
          .select('id, user_id, task_id, start_at, end_at, status, proposal_id, reason, gcal_event_id, last_synced_at')
          .eq('proposal_id', id!)
          .order('start_at'),
      ]);
      return { proposal: unwrap(p) as Proposal | null, blocks: unwrap(b) as TaskBlock[] };
    },
  });
}

/** Proposed (not yet reviewed) blocks in a range — shown dashed on the calendar. */
export function useProposedBlocks(from: string, to: string) {
  return useQuery({
    queryKey: qk.proposedBlocks(from, to),
    queryFn: async () =>
      unwrap(
        await requireSupabase()
          .from('task_blocks')
          .select(
            'id, user_id, task_id, start_at, end_at, status, proposal_id, reason, gcal_event_id, last_synced_at, ai_proposals!inner(status)',
          )
          .eq('status', 'proposed')
          .eq('ai_proposals.status', 'pending')
          .lt('start_at', to)
          .gt('end_at', from)
          .order('start_at'),
      ) as TaskBlock[],
  });
}
