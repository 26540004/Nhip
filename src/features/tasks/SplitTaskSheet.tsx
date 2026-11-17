/** "✦ Chia nhỏ việc này": AI proposes steps; the user edits/removes them, then creates subtasks. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { showToast } from '../../components/Toast';
import { vi } from '../../i18n/vi';
import { type SplitStepDto, splitTask } from '../../lib/api/functions';
import { newId, type TaskCreate, useCreateTasks } from '../../lib/api/mutations';
import type { Task } from '../../lib/api/types';
import { formatDurationCompact } from '../../lib/time/format';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../../theme/tokens';
import { errorText } from '../media/AudioCard';

const STEPS = [10, 15, 20, 30, 45, 60, 75, 90];

export function SplitTaskSheet({
  task,
  existing,
  privacy,
  visible,
  onClose,
}: {
  task: Task;
  existing: number;
  privacy: boolean;
  visible: boolean;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const createTasks = useCreateTasks();
  const [steps, setSteps] = useState<SplitStepDto[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    splitTask(task.id)
      .then((r) => alive && setSteps(r.steps))
      .catch((e: unknown) => alive && setFailed(errorText(e)));
    return () => {
      alive = false;
    };
  }, [visible, task.id]);

  const close = () => {
    setSteps(null);
    setFailed(null);
    onClose();
  };
  const edit = (i: number, patch: Partial<SplitStepDto>) => setSteps((s) => s?.map((x, j) => (j === i ? { ...x, ...patch } : x)) ?? null);
  const cycle = (i: number) => {
    const cur = steps?.[i]?.estimate_minutes ?? 30;
    edit(i, { estimate_minutes: STEPS[(STEPS.indexOf(cur) + 1) % STEPS.length] ?? 30 });
  };
  const valid = (steps ?? []).filter((s) => s.title.trim());

  const create = () => {
    const rows: TaskCreate[] = valid.map((s, i) => ({
      id: newId(),
      parent_task_id: task.id,
      title: s.title.trim(),
      estimate_minutes: s.estimate_minutes,
      space: task.space,
      collection_id: task.collection_id,
      priority: task.priority,
      deadline_at: task.deadline_at,
      source: 'ai_split',
      sort_order: existing + i,
    }));
    createTasks.mutate(rows);
    showToast(vi.split.created(rows.length));
    close();
  };

  return (
    <Sheet visible={visible} onClose={close} label={vi.split.title}>
      <View style={styles.gap}>
        <AppText variant="section">{vi.split.title}</AppText>
        {privacy && (
          <AppText variant="secondary" tone="muted">
            {vi.split.privacy}
          </AppText>
        )}
        {failed ? (
          <AppText variant="body" tone="danger">
            {failed}
          </AppText>
        ) : !steps ? (
          <View style={[styles.working, { backgroundColor: colors.primarySoft }]} accessibilityLiveRegion="polite">
            <Ionicons name="sparkles" size={18} color={colors.primary} />
            <AppText variant="body" tone="primary">
              {vi.split.working}
            </AppText>
          </View>
        ) : (
          <>
            <AppText variant="secondary" tone="muted">
              {existing > 0 ? vi.split.hasSubtasks : vi.split.help}
            </AppText>
            {steps.map((s, i) => (
              <View key={i} style={[styles.row, { backgroundColor: colors.surface2 }]}>
                <AppText variant="meta" tone="muted" numeric style={styles.num}>
                  {i + 1}
                </AppText>
                <TextInput
                  value={s.title}
                  onChangeText={(t) => edit(i, { title: t })}
                  placeholder={vi.split.stepPlaceholder}
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel={`${vi.split.stepPlaceholder} ${i + 1}`}
                  style={[styles.input, { color: colors.textHeading }]}
                  multiline
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${formatDurationCompact(s.estimate_minutes)} — ${vi.tasks.fields.estimate}`}
                  onPress={() => cycle(i)}
                  style={[styles.est, { borderColor: colors.border }]}
                >
                  <AppText variant="meta" tone="heading" numeric>
                    {formatDurationCompact(s.estimate_minutes)}
                  </AppText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={vi.split.remove(s.title)}
                  onPress={() => setSteps(steps.filter((_, j) => j !== i))}
                  style={styles.icon}
                >
                  <Ionicons name="close" size={18} color={colors.textMuted} />
                </Pressable>
              </View>
            ))}
            <AppText variant="secondary" tone="muted" numeric>
              {vi.split.total(formatDurationCompact(valid.reduce((sum, s) => sum + s.estimate_minutes, 0)))}
            </AppText>
            <Button label={vi.split.create(valid.length)} disabled={valid.length === 0} onPress={create} />
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.md },
  working: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderRadius: radius.input, paddingLeft: spacing.sm },
  num: { width: 18, textAlign: 'center' },
  input: { flex: 1, fontSize: 16, paddingVertical: spacing.sm, outlineStyle: 'none' } as object,
  est: { borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: spacing.sm, paddingVertical: 4, minWidth: 52, alignItems: 'center' },
  icon: { width: touchTarget - 4, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
});
