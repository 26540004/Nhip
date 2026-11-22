/**
 * Writes with optimistic updates and an offline queue.
 *
 * Every mutation has a registered default (mutationFn by key) so paused mutations can be
 * persisted and replayed after an app restart. All writes share one scope, so they replay
 * strictly in order (a subtask is never inserted before its parent).
 * Ids are generated on the client, so rows created offline are referenceable immediately.
 */
import { type QueryClient, useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { qk, type NoteListItem, type SettingsBundle } from './queries';
import type { CorrectionRow, HabitAnswers, VocabRow } from './habits';
import { requireSupabase, unwrap } from './supabase';
import type {
  Attachment,
  AudioSegment,
  CapacityRow,
  ClassSessionRow,
  Collection,
  Note,
  ScheduleExceptionRow,
  StudyWindowRow,
  Task,
  WorkHoursRow,
} from './types';

const SCOPE = { id: 'nhip-sync' };

export const newId = (): string => Crypto.randomUUID();

export type TaskCreate = Pick<Task, 'id' | 'title' | 'space'> &
  Partial<Omit<Task, 'id' | 'title' | 'space' | 'user_id' | 'created_at' | 'updated_at'>>;
export type TaskPatch = Partial<Omit<Task, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;
export type NoteCreate = Pick<Note, 'id' | 'space'> & Partial<Omit<Note, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;
export type NotePatch = Partial<Omit<Note, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;
export interface LinkAttachmentCreate {
  id: string;
  owner_type: 'note' | 'task';
  owner_id: string;
  url: string;
  title?: string | null;
}

export type AttachmentCreate = Pick<Attachment, 'id' | 'owner_type' | 'owner_id' | 'type'> &
  Partial<Pick<Attachment, 'storage_path' | 'url' | 'title' | 'meta_json' | 'duration_sec' | 'bookmarks_json'>>;
export type AttachmentPatch = Partial<
  Pick<Attachment, 'title' | 'url' | 'meta_json' | 'duration_sec' | 'bookmarks_json' | 'owner_id' | 'owner_type'>
>;
export interface SegmentCreate {
  id: string;
  attachment_id: string;
  seq: number;
  storage_path: string;
  mime: string;
  start_offset_sec: number;
  duration_sec: number;
  uploaded?: boolean;
}

/** Storage objects (files, thumbnails, audio segments) that belong to these owners. */
async function ownedObjectPaths(ownerIds: string[]): Promise<string[]> {
  const db = requireSupabase();
  const atts = unwrap(await db.from('attachments').select('id, storage_path, meta_json').in('owner_id', ownerIds)) as Pick<
    Attachment,
    'id' | 'storage_path' | 'meta_json'
  >[];
  return attachmentObjectPaths(atts);
}

async function attachmentObjectPaths(atts: Pick<Attachment, 'id' | 'storage_path' | 'meta_json'>[]): Promise<string[]> {
  if (atts.length === 0) return [];
  const segs = unwrap(
    await requireSupabase()
      .from('audio_segments')
      .select('storage_path')
      .in(
        'attachment_id',
        atts.map((a) => a.id),
      ),
  ) as { storage_path: string }[];
  const paths = atts.flatMap((a) => [a.storage_path, typeof a.meta_json?.thumb_path === 'string' ? a.meta_json.thumb_path : null]);
  return [...paths, ...segs.map((x) => x.storage_path)].filter((p): p is string => Boolean(p));
}

/** Best effort: a leftover file is harmless (private bucket), a failed row delete is not. */
async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await requireSupabase().storage.from('attachments').remove(paths);
  } catch {
    /* ignore */
  }
}

const MUTATIONS = {
  // Rows in one batch can have different keys (subtasks, estimates…): missing columns must take
  // their database defaults, not NULL.
  taskCreate: async (rows: TaskCreate[]) =>
    unwrap(await requireSupabase().from('tasks').insert(rows, { defaultToNull: false }).select('id')),
  taskUpdate: async ({ id, patch }: { id: string; patch: TaskPatch }) =>
    unwrap(await requireSupabase().from('tasks').update(patch).eq('id', id).select('id')),
  taskDelete: async (id: string) => {
    const paths = await ownedObjectPaths([id]).catch(() => []);
    const res = unwrap(await requireSupabase().from('tasks').delete().eq('id', id).select('id'));
    await removeObjects(paths);
    return res;
  },
  noteCreate: async (row: NoteCreate) => unwrap(await requireSupabase().from('notes').insert(row).select('id')),
  noteUpdate: async ({ id, patch }: { id: string; patch: NotePatch }) =>
    unwrap(await requireSupabase().from('notes').update(patch).eq('id', id).select('id')),
  noteDelete: async (id: string) => {
    const paths = await ownedObjectPaths([id]).catch(() => []);
    const res = unwrap(await requireSupabase().from('notes').delete().eq('id', id).select('id'));
    await removeObjects(paths);
    return res;
  },
  collectionUpsert: async (row: Pick<Collection, 'id' | 'space' | 'kind' | 'name'> & Partial<Collection>) =>
    unwrap(await requireSupabase().from('collections').upsert(row).select('id')),
  profileUpdate: async (patch: { display_name?: string | null; ai_privacy_mode?: boolean; onboarding_completed_at?: string | null }) => {
    const db = requireSupabase();
    const { data } = await db.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) throw new Error('unauthorized');
    return unwrap(await db.from('profiles').update(patch).eq('id', uid).select('id'));
  },
  reminderUpdate: async (patch: Record<string, unknown>) => {
    const db = requireSupabase();
    const { data } = await db.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) throw new Error('unauthorized');
    return unwrap(await db.from('reminder_settings').update(patch).eq('user_id', uid).select('user_id'));
  },
  linkDelete: async (id: string) => unwrap(await requireSupabase().from('attachments').delete().eq('id', id).select('id')),
  // ----- schedule settings (office hours, study windows, timetable, capacity) -----
  workHoursUpsert: async (rows: WorkHoursRow[]) =>
    unwrap(await requireSupabase().from('work_hours').upsert(rows, { onConflict: 'user_id,weekday' }).select('weekday')),
  studyWindowsReplace: async ({ weekdays, windows }: { weekdays: number[]; windows: StudyWindowRow[] }) => {
    const db = requireSupabase();
    unwrap(await db.from('study_windows').delete().in('weekday', weekdays).select('id'));
    return windows.length ? unwrap(await db.from('study_windows').insert(windows).select('id')) : [];
  },
  studyWindowDelete: async (id: string) => unwrap(await requireSupabase().from('study_windows').delete().eq('id', id).select('id')),
  classSessionUpsert: async (row: ClassSessionRow) => unwrap(await requireSupabase().from('class_sessions').upsert(row).select('id')),
  classSessionDelete: async (id: string) => unwrap(await requireSupabase().from('class_sessions').delete().eq('id', id).select('id')),
  exceptionCreate: async (row: ScheduleExceptionRow) =>
    unwrap(await requireSupabase().from('schedule_exceptions').insert(row).select('id')),
  exceptionDelete: async (id: string) => unwrap(await requireSupabase().from('schedule_exceptions').delete().eq('id', id).select('id')),
  capacityUpsert: async (rows: CapacityRow[]) =>
    unwrap(await requireSupabase().from('capacity_settings').upsert(rows, { onConflict: 'user_id,space,weekday' }).select('space')),
  attachmentCreate: async (row: AttachmentCreate) => unwrap(await requireSupabase().from('attachments').insert(row).select('id')),
  attachmentUpdate: async ({ id, patch }: { id: string; patch: AttachmentPatch }) =>
    unwrap(await requireSupabase().from('attachments').update(patch).eq('id', id).select('id')),
  attachmentDelete: async (id: string) => {
    const atts = unwrap(await requireSupabase().from('attachments').select('id, storage_path, meta_json').eq('id', id)) as Pick<
      Attachment,
      'id' | 'storage_path' | 'meta_json'
    >[];
    const paths = await attachmentObjectPaths(atts).catch(() => []);
    const res = unwrap(await requireSupabase().from('attachments').delete().eq('id', id).select('id'));
    await removeObjects(paths);
    return res;
  },
  segmentCreate: async (row: SegmentCreate) =>
    unwrap(await requireSupabase().from('audio_segments').upsert(row, { onConflict: 'attachment_id,seq' }).select('id')),
  segmentUpdate: async ({ id, patch }: { id: string; patch: { uploaded?: boolean; duration_sec?: number } }) =>
    unwrap(await requireSupabase().from('audio_segments').update(patch).eq('id', id).select('id')),
  // ----- habit profile ("Nhịp hiểu về bạn") -----
  habitSettingsUpsert: async (row: { learning_enabled?: boolean; answers?: HabitAnswers }) =>
    unwrap(await requireSupabase().from('habit_settings').upsert(row, { onConflict: 'user_id', defaultToNull: false }).select('user_id')),
  vocabCreate: async (rows: VocabRow[]) =>
    unwrap(
      await requireSupabase()
        .from('vocab_entries')
        .upsert(rows, { onConflict: 'user_id,short_key', ignoreDuplicates: true, defaultToNull: false })
        .select('id'),
    ),
  vocabDelete: async (id: string) => unwrap(await requireSupabase().from('vocab_entries').delete().eq('id', id).select('id')),
  correctionsCreate: async (rows: CorrectionRow[]) =>
    rows.length ? unwrap(await requireSupabase().from('ai_corrections').insert(rows).select('id')) : [],
  correctionDelete: async (id: string) => unwrap(await requireSupabase().from('ai_corrections').delete().eq('id', id).select('id')),
  habitsReset: async () => {
    const db = requireSupabase();
    // Deletes are RLS-scoped to the signed-in user; the filter is only to satisfy PostgREST.
    unwrap(await db.from('ai_corrections').delete().not('id', 'is', null).select('id'));
    unwrap(await db.from('vocab_entries').delete().not('id', 'is', null).select('id'));
    unwrap(await db.from('habit_settings').delete().not('user_id', 'is', null).select('user_id'));
    return true;
  },
  linkCreate: async (rows: LinkAttachmentCreate[]) =>
    unwrap(
      await requireSupabase()
        .from('attachments')
        .insert(
          rows.map((r) => ({ ...r, type: 'link' as const })),
          { defaultToNull: false },
        )
        .select('id'),
    ),
} as const;

export type MutationName = keyof typeof MUTATIONS;

/** Call once at startup, before persisted mutations are resumed. */
export function registerMutationDefaults(client: QueryClient): void {
  for (const name of Object.keys(MUTATIONS) as MutationName[]) {
    client.setMutationDefaults([name], { mutationFn: MUTATIONS[name] as (v: unknown) => Promise<unknown>, scope: SCOPE });
  }
}

/** Number of writes waiting for the network ("Chờ đồng bộ"). */
export function usePendingSyncCount(): number {
  return useMutationState({ filters: { predicate: (m) => m.state.isPaused } }).length;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

function taskDefaults(t: TaskCreate): Task {
  const ts = nowIso();
  return {
    user_id: '',
    collection_id: null,
    parent_task_id: null,
    description: null,
    deadline_at: null,
    estimate_minutes: null,
    priority: 2,
    priority_reason: null,
    status: 'todo',
    source: 'form',
    source_note_id: null,
    needs_parse: false,
    sort_order: 0,
    completed_at: null,
    actual_minutes: null,
    created_at: ts,
    updated_at: ts,
    ...t,
  };
}

export function useCreateTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['taskCreate'],
    mutationFn: MUTATIONS.taskCreate,
    scope: SCOPE,
    onMutate: async (rows: TaskCreate[]) => {
      await qc.cancelQueries({ queryKey: qk.tasks });
      qc.setQueryData<Task[]>(qk.tasks, (old) => [...(old ?? []), ...rows.map(taskDefaults)]);
    },
    onError: () => qc.invalidateQueries({ queryKey: qk.tasks }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.tasks }),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['taskUpdate'],
    mutationFn: MUTATIONS.taskUpdate,
    scope: SCOPE,
    onMutate: async ({ id, patch }: { id: string; patch: TaskPatch }) => {
      await qc.cancelQueries({ queryKey: qk.tasks });
      qc.setQueryData<Task[]>(qk.tasks, (old) => old?.map((t) => (t.id === id ? { ...t, ...patch, updated_at: nowIso() } : t)));
    },
    onError: () => qc.invalidateQueries({ queryKey: qk.tasks }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.tasks }),
  });
}

/** Done ⇄ todo, keeping the DB constraint (done ⇔ completed_at). */
export function completionPatch(done: boolean): TaskPatch {
  return done ? { status: 'done', completed_at: nowIso() } : { status: 'todo', completed_at: null };
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['taskDelete'],
    mutationFn: MUTATIONS.taskDelete,
    scope: SCOPE,
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: qk.tasks });
      qc.setQueryData<Task[]>(qk.tasks, (old) => old?.filter((t) => t.id !== id && t.parent_task_id !== id));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.tasks }),
  });
}

export function useCreateLinks() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['linkCreate'],
    mutationFn: MUTATIONS.linkCreate,
    scope: SCOPE,
    onSettled: (_d, _e, rows) => {
      for (const owner of new Set(rows.map((r) => r.owner_id))) void qc.invalidateQueries({ queryKey: qk.links(owner) });
    },
  });
}

export function useDeleteLink(ownerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['linkDelete'],
    mutationFn: MUTATIONS.linkDelete,
    scope: SCOPE,
    onSettled: () => qc.invalidateQueries({ queryKey: qk.links(ownerId) }),
  });
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['noteCreate'],
    mutationFn: MUTATIONS.noteCreate,
    scope: SCOPE,
    onMutate: async (row: NoteCreate) => {
      const ts = nowIso();
      const full: Note = {
        user_id: '',
        collection_id: null,
        title: '',
        content_json: {},
        plain_text: '',
        pinned: false,
        created_at: ts,
        updated_at: ts,
        ...row,
      };
      qc.setQueryData<Note | null>(qk.note(row.id), full);
      qc.setQueryData<NoteListItem[]>(qk.notes, (old) => [{ ...full, attachment_types: [] }, ...(old ?? [])]);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notes }),
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['noteUpdate'],
    mutationFn: MUTATIONS.noteUpdate,
    scope: SCOPE,
    onMutate: async ({ id, patch }: { id: string; patch: NotePatch }) => {
      const ts = nowIso();
      qc.setQueryData<Note | null>(qk.note(id), (old) => (old ? { ...old, ...patch, updated_at: ts } : old));
      qc.setQueryData<NoteListItem[]>(qk.notes, (old) => old?.map((n) => (n.id === id ? { ...n, ...patch, updated_at: ts } : n)));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notes }),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['noteDelete'],
    mutationFn: MUTATIONS.noteDelete,
    scope: SCOPE,
    onMutate: async (id: string) => {
      qc.setQueryData<NoteListItem[]>(qk.notes, (old) => old?.filter((n) => n.id !== id));
      qc.removeQueries({ queryKey: qk.note(id) });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notes }),
  });
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export function useUpsertCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['collectionUpsert'],
    mutationFn: MUTATIONS.collectionUpsert,
    scope: SCOPE,
    onMutate: async (row) => {
      qc.setQueryData<Collection[]>(qk.collections, (old) => {
        const list = old ?? [];
        const existing = list.find((c) => c.id === row.id);
        const merged: Collection = { user_id: '', color_variant: 0, archived: false, created_at: nowIso(), ...existing, ...row };
        return existing ? list.map((c) => (c.id === row.id ? merged : c)) : [...list, merged];
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.collections }),
  });
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['profileUpdate'],
    mutationFn: MUTATIONS.profileUpdate,
    scope: SCOPE,
    onMutate: async (patch) => {
      qc.setQueryData<SettingsBundle>(qk.settings, (old) => (old && old.profile ? { ...old, profile: { ...old.profile, ...patch } } : old));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.settings }),
  });
}

/** Generic queued write for feature modules (same ordered, persisted offline queue). */
export function useQueuedWrite<V>(key: MutationName, opts: { onMutate?: (v: V) => void | Promise<void>; invalidate: readonly unknown[] }) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [key],
    mutationFn: MUTATIONS[key] as unknown as (v: V) => Promise<unknown>,
    scope: SCOPE,
    onMutate: opts.onMutate,
    onSettled: () => qc.invalidateQueries({ queryKey: opts.invalidate }),
  });
}

/** Settings writes: ordered offline queue + optimistic update of the settings bundle. */
function useSettingsWrite<V>(key: keyof typeof MUTATIONS, apply: (b: SettingsBundle, v: V) => SettingsBundle) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [key],
    mutationFn: MUTATIONS[key] as unknown as (v: V) => Promise<unknown>,
    scope: SCOPE,
    onMutate: async (v: V) => {
      await qc.cancelQueries({ queryKey: qk.settings });
      qc.setQueryData<SettingsBundle>(qk.settings, (old) => (old ? apply(old, v) : old));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.settings }),
  });
}

export const useUpsertWorkHours = () =>
  useSettingsWrite<WorkHoursRow[]>('workHoursUpsert', (b, rows) => ({
    ...b,
    workHours: [...b.workHours.filter((w) => !rows.some((r) => r.weekday === w.weekday)), ...rows].sort((a, c) => a.weekday - c.weekday),
  }));

export const useReplaceStudyWindows = () =>
  useSettingsWrite<{ weekdays: number[]; windows: StudyWindowRow[] }>('studyWindowsReplace', (b, v) => ({
    ...b,
    studyWindows: [...b.studyWindows.filter((w) => !v.weekdays.includes(w.weekday)), ...v.windows],
  }));

export const useDeleteStudyWindow = () =>
  useSettingsWrite<string>('studyWindowDelete', (b, id) => ({ ...b, studyWindows: b.studyWindows.filter((w) => w.id !== id) }));

export const useSaveClassSession = () =>
  useSettingsWrite<ClassSessionRow>('classSessionUpsert', (b, row) => ({
    ...b,
    classSessions: [...b.classSessions.filter((c) => c.id !== row.id), row],
  }));

export const useDeleteClassSession = () =>
  useSettingsWrite<string>('classSessionDelete', (b, id) => ({
    ...b,
    classSessions: b.classSessions.filter((c) => c.id !== id),
    exceptions: b.exceptions.filter((e) => e.class_session_id !== id),
  }));

export const useCreateException = () =>
  useSettingsWrite<ScheduleExceptionRow>('exceptionCreate', (b, row) => ({ ...b, exceptions: [...b.exceptions, row] }));

export const useDeleteException = () =>
  useSettingsWrite<string>('exceptionDelete', (b, id) => ({ ...b, exceptions: b.exceptions.filter((e) => e.id !== id) }));

export const useUpsertCapacity = () =>
  useSettingsWrite<CapacityRow[]>('capacityUpsert', (b, rows) => ({
    ...b,
    capacity: [...b.capacity.filter((c) => !rows.some((r) => r.space === c.space && r.weekday === c.weekday)), ...rows],
  }));

export function useUpdateReminders() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['reminderUpdate'],
    mutationFn: MUTATIONS.reminderUpdate,
    scope: SCOPE,
    onMutate: async (patch) => {
      qc.setQueryData<SettingsBundle>(qk.settings, (old) =>
        old && old.reminders ? { ...old, reminders: { ...old.reminders, ...patch } } : old,
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.settings }),
  });
}

// ---------------------------------------------------------------------------
// Attachments (images, audio, links) and audio segments
// ---------------------------------------------------------------------------

function attachmentDefaults(row: AttachmentCreate): Attachment {
  const ts = nowIso();
  return {
    storage_path: null,
    url: null,
    title: null,
    meta_json: {},
    duration_sec: null,
    bookmarks_json: [],
    transcript_status: 'none',
    transcript_text: null,
    summary_json: null,
    created_at: ts,
    updated_at: ts,
    ...row,
  };
}

export function useCreateAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['attachmentCreate'],
    mutationFn: MUTATIONS.attachmentCreate,
    scope: SCOPE,
    onMutate: async (row: AttachmentCreate) => {
      qc.setQueryData<Attachment[]>(qk.attachments(row.owner_id), (old) => [
        ...(old ?? []).filter((a) => a.id !== row.id),
        attachmentDefaults(row),
      ]);
      qc.setQueryData<NoteListItem[]>(qk.notes, (old) =>
        old?.map((n) => (n.id === row.owner_id ? { ...n, attachment_types: [...new Set([...(n.attachment_types ?? []), row.type])] } : n)),
      );
    },
    onSettled: (_d, _e, row) => {
      void qc.invalidateQueries({ queryKey: qk.attachments(row.owner_id) });
      void qc.invalidateQueries({ queryKey: qk.notes });
    },
  });
}

export function useUpdateAttachment(ownerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['attachmentUpdate'],
    mutationFn: MUTATIONS.attachmentUpdate,
    scope: SCOPE,
    onMutate: async ({ id, patch }: { id: string; patch: AttachmentPatch }) => {
      qc.setQueryData<Attachment[]>(qk.attachments(ownerId), (old) => old?.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.attachments(ownerId) }),
  });
}

export function useDeleteAttachment(ownerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['attachmentDelete'],
    mutationFn: MUTATIONS.attachmentDelete,
    scope: SCOPE,
    onMutate: async (id: string) => {
      qc.setQueryData<Attachment[]>(qk.attachments(ownerId), (old) => old?.filter((a) => a.id !== id));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.attachments(ownerId) });
      void qc.invalidateQueries({ queryKey: qk.notes });
    },
  });
}

/**
 * Segment writes outside React (the recorder and upload worker run in the background).
 * They go through the same persisted, ordered queue as every other write.
 */
export function enqueueWrite<
  K extends
    'segmentCreate' | 'segmentUpdate' | 'attachmentUpdate' | 'attachmentCreate' | 'attachmentDelete' | 'taskCreate' | 'correctionsCreate',
>(client: QueryClient, key: K, variables: Parameters<(typeof MUTATIONS)[K]>[0]): Promise<unknown> {
  // Optimistic cache updates (the hooks do this in onMutate).
  if (key === 'attachmentCreate') {
    const row = variables as AttachmentCreate;
    client.setQueryData<Attachment[]>(qk.attachments(row.owner_id), (old) => [
      ...(old ?? []).filter((a) => a.id !== row.id),
      attachmentDefaults(row),
    ]);
  } else if (key === 'segmentCreate') {
    const row = variables as SegmentCreate;
    client.setQueryData<AudioSegment[]>(qk.segments(row.attachment_id), (old) => [
      ...(old ?? []).filter((x) => x.seq !== row.seq),
      { uploaded: false, transcript_status: 'none', transcript_json: null, last_error: null, ...row },
    ]);
  } else if (key === 'attachmentDelete') {
    const id = variables as string;
    client.setQueriesData<Attachment[]>({ queryKey: ['attachments'] }, (old) => old?.filter((a) => a.id !== id));
  } else if (key === 'taskCreate') {
    client.setQueryData<Task[]>(qk.tasks, (old) => [...(old ?? []), ...(variables as TaskCreate[]).map(taskDefaults)]);
  } else if (key === 'attachmentUpdate') {
    const { id, patch } = variables as { id: string; patch: AttachmentPatch };
    client.setQueriesData<Attachment[]>({ queryKey: ['attachments'] }, (old) => old?.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }
  const m = client.getMutationCache().build(client, client.defaultMutationOptions({ mutationKey: [key], scope: SCOPE }));
  return m.execute(variables as never).then((r) => {
    if (key === 'taskCreate') void client.invalidateQueries({ queryKey: qk.tasks });
    else if (key === 'correctionsCreate') void client.invalidateQueries({ queryKey: ['habits'] });
    else if (key === 'segmentCreate' || key === 'segmentUpdate') {
      const attId = key === 'segmentCreate' ? (variables as SegmentCreate).attachment_id : null;
      void client.invalidateQueries({ queryKey: attId ? qk.segments(attId) : ['segments'] });
    } else void client.invalidateQueries({ queryKey: ['attachments'] });
    return r;
  });
}
