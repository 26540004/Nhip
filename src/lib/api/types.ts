/**
 * Row types mirroring supabase/migrations (snake_case, as returned by PostgREST).
 * Timestamps are ISO strings (UTC); local wall-clock columns are 'HH:mm:ss'.
 */
export type Space = 'study' | 'work';
export type Priority = 1 | 2 | 3;
export type TaskStatus = 'todo' | 'doing' | 'done' | 'dropped';
export type TaskSource = 'quick_add' | 'form' | 'note' | 'ai_split';
export type BlockStatus = 'proposed' | 'accepted' | 'synced' | 'rejected' | 'conflict';

export interface Profile {
  id: string;
  display_name: string | null;
  timezone: string;
  ai_privacy_mode: boolean;
  daily_ai_calls: number;
  daily_ai_calls_date: string;
  onboarding_completed_at: string | null;
}

export interface Collection {
  id: string;
  user_id: string;
  space: Space;
  kind: 'subject' | 'project';
  name: string;
  color_variant: number;
  archived: boolean;
  created_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  space: Space;
  collection_id: string | null;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  deadline_at: string | null;
  estimate_minutes: number | null;
  priority: Priority;
  priority_reason: string | null;
  status: TaskStatus;
  source: TaskSource;
  source_note_id: string | null;
  needs_parse: boolean;
  sort_order: number;
  completed_at: string | null;
  actual_minutes: number | null;
  created_at: string;
  updated_at: string;
}

export interface TaskBlock {
  id: string;
  user_id: string;
  task_id: string;
  start_at: string;
  end_at: string;
  status: BlockStatus;
  proposal_id: string | null;
  reason: string | null;
  gcal_event_id: string | null;
  last_synced_at: string | null;
}

export interface Note {
  id: string;
  user_id: string;
  space: Space;
  collection_id: string | null;
  title: string;
  content_json: unknown;
  plain_text: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: string;
  owner_type: 'note' | 'task';
  owner_id: string;
  type: 'image' | 'audio' | 'link' | 'file';
  storage_path: string | null;
  url: string | null;
  title: string | null;
  meta_json: Record<string, unknown>;
  created_at: string;
}

export interface WorkHoursRow {
  weekday: number;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
  enabled: boolean;
}

export interface StudyWindowRow {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface ClassSessionRow {
  id: string;
  collection_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  location: string | null;
  valid_from: string | null;
  valid_to: string | null;
}

export interface ScheduleExceptionRow {
  id: string;
  class_session_id: string | null;
  date: string;
  type: 'cancelled' | 'moved' | 'extra';
  new_start_at: string | null;
  new_end_at: string | null;
}

export interface CapacityRow {
  space: Space;
  weekday: number;
  max_focus_minutes: number;
}

export interface BusyRow {
  id: string;
  source_calendar_id: string;
  start_at: string;
  end_at: string;
  title: string | null;
  all_day: boolean;
}

export interface SearchHit {
  kind: 'task' | 'note' | 'transcript';
  id: string;
  owner_id: string | null;
  title: string;
  snippet: string;
  rank: number;
  updated_at: string;
}

/** parse-task Edge Function response (mirrors supabase/functions/_shared/parse-task-core.ts). */
export interface ParsedTask {
  title: string;
  space: Space;
  space_uncertain: boolean;
  collection_id: string | null;
  collection_name: string | null;
  deadline_at: string | null;
  estimate_minutes: number | null;
  priority: Priority;
  priority_reason: string;
  subtasks: { title: string; estimate_minutes: number }[];
}

export interface ParseTaskResponse {
  tasks: ParsedTask[];
  url: string | null;
  provider: string;
}
