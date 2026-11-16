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
import { requireSupabase, unwrap } from './supabase';
import type { Collection, Note, Task } from './types';

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

const MUTATIONS = {
  taskCreate: async (rows: TaskCreate[]) => unwrap(await requireSupabase().from('tasks').insert(rows).select('id')),
  taskUpdate: async ({ id, patch }: { id: string; patch: TaskPatch }) =>
    unwrap(await requireSupabase().from('tasks').update(patch).eq('id', id).select('id')),
  taskDelete: async (id: string) => unwrap(await requireSupabase().from('tasks').delete().eq('id', id).select('id')),
  noteCreate: async (row: NoteCreate) => unwrap(await requireSupabase().from('notes').insert(row).select('id')),
  noteUpdate: async ({ id, patch }: { id: string; patch: NotePatch }) =>
    unwrap(await requireSupabase().from('notes').update(patch).eq('id', id).select('id')),
  noteDelete: async (id: string) => unwrap(await requireSupabase().from('notes').delete().eq('id', id).select('id')),
  collectionUpsert: async (row: Pick<Collection, 'id' | 'space' | 'kind' | 'name'> & Partial<Collection>) =>
    unwrap(await requireSupabase().from('collections').upsert(row).select('id')),
  profileUpdate: async (patch: { display_name?: string | null; ai_privacy_mode?: boolean }) => {
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
  linkCreate: async (rows: LinkAttachmentCreate[]) =>
    unwrap(
      await requireSupabase()
        .from('attachments')
        .insert(rows.map((r) => ({ ...r, type: 'link' as const })))
        .select('id'),
    ),
} as const;

type MutationName = keyof typeof MUTATIONS;

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
