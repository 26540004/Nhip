/** Block detail: open task · Đổi giờ (valid slots only — accessible alternative to dragging) · done · drop. */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { errorMessage } from '../../components/QueryState';
import { Sheet } from '../../components/Sheet';
import { showToast } from '../../components/Toast';
import { useSync } from '../../hooks/useSync';
import { vi } from '../../i18n/vi';
import { dropBlock } from '../../lib/api/blocks';
import { completionPatch, useUpdateTask } from '../../lib/api/mutations';
import type { Task, TaskBlock } from '../../lib/api/types';
import { slotOptions } from '../../lib/planning/moves';
import { formatDayHeader, formatDurationLong, formatTimeRange } from '../../lib/time/format';
import { addDaysToKey, dateKeyOf, localToInstant, MINUTE } from '../../lib/time/tz';
import { spacing } from '../../theme/tokens';
import { planTaskOf, type usePlanningData } from './usePlanningData';

export function BlockSheet({
  block,
  task,
  planning,
  onClose,
  onMove,
}: {
  block: TaskBlock;
  task: Task;
  planning: ReturnType<typeof usePlanningData>;
  onClose: () => void;
  onMove: (start: number) => Promise<void>;
}) {
  const tz = planning.rules.tz;
  const start = Date.parse(block.start_at);
  const end = Date.parse(block.end_at);
  const [picking, setPicking] = useState(false);
  const [day, setDay] = useState(dateKeyOf(start, tz));
  const update = useUpdateTask();
  const { connected, syncNow } = useSync();

  const options = useMemo(() => {
    if (!picking) return [];
    const window = { start: localToInstant(day, 0, tz), end: localToInstant(day, 1440, tz) };
    return slotOptions(planning.moveContext(new Set([block.id])), planTaskOf(task), Math.round((end - start) / MINUTE), window);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking, day, planning.ctx]);

  const drop = async () => {
    try {
      await dropBlock(block.id);
      await planning.refetch();
      if (connected) void syncNow({ force: true });
      showToast(vi.block.dropped);
      onClose();
    } catch (e) {
      showToast(errorMessage(e), { tone: 'error' });
    }
  };

  return (
    <Sheet visible onClose={onClose} label={task.title}>
      <AppText variant="section">{task.title}</AppText>
      <AppText variant="secondary" numeric>
        {`${formatDayHeader(dateKeyOf(start, tz))} · ${formatTimeRange(start, end, tz)} · ${formatDurationLong(Math.round((end - start) / MINUTE))}`}
      </AppText>
      {block.status === 'conflict' && (
        <AppText variant="secondary" tone="danger">
          {vi.block.conflict}
        </AppText>
      )}
      {picking && (
        <View style={styles.picker}>
          <View style={styles.wrap}>
            {[-1, 0, 1, 2]
              .map((off) => addDaysToKey(dateKeyOf(start, tz), off))
              .filter((k) => k >= dateKeyOf(planning.now, tz))
              .map((k) => {
                return <Chip key={k} label={formatDayHeader(k)} selected={day === k} onPress={() => setDay(k)} />;
              })}
          </View>
          {options.length === 0 ? (
            <AppText variant="secondary" tone="warning">
              {vi.review.noValidSlots}
            </AppText>
          ) : (
            <View style={styles.wrap}>
              {options.map((o) => (
                <Chip
                  key={o.start}
                  label={formatTimeRange(o.start, o.end, tz)}
                  selected={o.start === start}
                  onPress={() => void onMove(o.start)}
                />
              ))}
            </View>
          )}
        </View>
      )}
      <View style={styles.actions}>
        <Button
          label={vi.block.openTask}
          variant="secondary"
          onPress={() => {
            onClose();
            router.push({ pathname: '/task/[id]', params: { id: task.id } });
          }}
        />
        <Button label={vi.block.changeTime} variant={picking ? 'primary' : 'secondary'} onPress={() => setPicking((p) => !p)} />
        {task.status !== 'done' && (
          <Button
            label={vi.block.markDone}
            variant="secondary"
            onPress={() => {
              update.mutate({ id: task.id, patch: completionPatch(true) });
              onClose();
            }}
          />
        )}
        <Button label={vi.block.drop} variant="ghost" onPress={() => void drop()} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  picker: { gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actions: { gap: spacing.sm },
});
