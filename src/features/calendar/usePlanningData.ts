/**
 * Everything the calendar / plan review needs for a time range, in planning-core shapes:
 * rules (office hours, study windows, classes), busy times, app blocks with their task's
 * space, and a MoveContext factory for validating manual moves.
 */
import { useMemo } from 'react';
import type { PlacedBlock, PlanTask } from '../../../supabase/functions/_shared/planning/engine.ts';
import { useNow } from '../../hooks/useNow';
import { useBlocks, useBusy, useSettings, useTasks } from '../../lib/api/queries';
import type { Task, TaskBlock } from '../../lib/api/types';
import type { MoveContext } from '../../lib/planning/moves';
import { rulesFromSettings } from '../../lib/settings/rules';
import type { SlotContext } from '../../lib/time/slots';

export function planTaskOf(t: Task): PlanTask {
  return {
    id: t.id,
    title: t.title,
    space: t.space,
    priority: t.priority,
    deadlineAt: t.deadline_at ? Date.parse(t.deadline_at) : null,
    remainingMinutes: t.estimate_minutes ?? 60,
  };
}

export function usePlanningData(range: { start: number; end: number }) {
  const now = useNow();
  const settings = useSettings();
  const rules = useMemo(() => rulesFromSettings(settings.data), [settings.data]);
  const fromIso = new Date(range.start).toISOString();
  const toIso = new Date(range.end).toISOString();
  const tasksQ = useTasks();
  const blocksQ = useBlocks(fromIso, toIso);
  const busyQ = useBusy(fromIso, toIso);

  const tasksById = useMemo(() => new Map((tasksQ.data ?? []).map((t) => [t.id, t])), [tasksQ.data]);
  const blocks = useMemo(() => blocksQ.data ?? [], [blocksQ.data]);
  const busy = useMemo(
    () => (busyQ.data ?? []).filter((b) => !b.all_day).map((b) => ({ start: Date.parse(b.start_at), end: Date.parse(b.end_at) })),
    [busyQ.data],
  );

  const ctx: SlotContext = useMemo(
    () => ({
      tz: rules.tz,
      range,
      now,
      workHours: rules.workHours,
      studyWindows: rules.studyWindows,
      classSessions: rules.classSessions,
      exceptions: rules.exceptions,
      busy,
      quietHours: rules.quietHours,
    }),
    [rules, range, now, busy],
  );

  const placed = useMemo(
    () =>
      blocks
        .map((b): (PlacedBlock & { id: string }) | null => {
          const t = tasksById.get(b.task_id);
          return t ? { id: b.id, taskId: b.task_id, space: t.space, start: Date.parse(b.start_at), end: Date.parse(b.end_at) } : null;
        })
        .filter((x): x is PlacedBlock & { id: string } => x != null),
    [blocks, tasksById],
  );

  /** MoveContext excluding the given block ids (the one being moved) plus extra occupied blocks. */
  const moveContext = (exclude: ReadonlySet<string>, extra: readonly PlacedBlock[] = []): MoveContext => ({
    ctx,
    capacity: rules.capacity,
    others: [...placed.filter((p) => !exclude.has(p.id)), ...extra],
  });

  return {
    now,
    rules,
    ctx,
    tasksById,
    blocks,
    busyRows: busyQ.data ?? [],
    placed,
    moveContext,
    settings: settings.data,
    isLoading: tasksQ.isLoading || blocksQ.isLoading,
    error: tasksQ.error ?? blocksQ.error,
    refetch: () => Promise.all([tasksQ.refetch(), blocksQ.refetch(), busyQ.refetch()]),
  };
}

export type BlockWithTask = { block: TaskBlock; task: Task };
