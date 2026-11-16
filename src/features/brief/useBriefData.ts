import { useMemo, useState } from 'react';
import type { BriefBlock, BriefInput, BriefTask } from '../../../supabase/functions/_shared/brief-core.ts';
import { useNow } from '../../hooks/useNow';
import { useBlocks, useSettings, useTasks } from '../../lib/api/queries';
import { rulesFromSettings } from '../../lib/settings/rules';

/** Inputs for buildBrief / buildReview from the cached queries. */
export function useBriefInput(): { input: BriefInput; ready: boolean; refetch: () => void } {
  const now = useNow();
  const [range] = useState(() => ({
    from: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    to: new Date(Date.now() + 10 * 86_400_000).toISOString(),
  }));
  const tasksQ = useTasks();
  const blocksQ = useBlocks(range.from, range.to);
  const settings = useSettings();
  const input = useMemo(() => {
    const rules = rulesFromSettings(settings.data);
    return {
      now,
      tz: rules.tz,
      tasks: (tasksQ.data ?? []) as BriefTask[],
      blocks: (blocksQ.data ?? []) as BriefBlock[],
      capacity: rules.capacity,
    };
  }, [now, tasksQ.data, blocksQ.data, settings.data]);
  return {
    input,
    ready: tasksQ.data != null && blocksQ.data != null,
    refetch: () => void Promise.all([tasksQ.refetch(), blocksQ.refetch()]),
  };
}
