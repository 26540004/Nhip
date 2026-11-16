import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { vi } from '../i18n/vi';
import type { Collection, Task } from '../lib/api/types';
import { formatCountdown } from '../lib/time/format';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, touchTarget } from '../theme/tokens';
import { AppText } from './AppText';
import { Checkbox } from './Checkbox';

const PRIORITY_ICON = { 1: 'arrow-up-circle', 2: 'remove-circle-outline', 3: 'arrow-down-circle-outline' } as const;

/**
 * Task row: checkbox, title (strike-through when done), space dot, collection, deadline
 * countdown, priority icon, scheduled indicator. Status is never color-only.
 */
export function TaskRow({
  task,
  collection,
  scheduled,
  now,
  selected,
  onPress,
  onToggle,
}: {
  task: Task;
  collection?: Collection | null;
  scheduled?: boolean;
  now: number;
  selected?: boolean;
  onPress: () => void;
  onToggle: (done: boolean) => void;
}) {
  const { colors } = useTheme();
  const done = task.status === 'done';
  const overdue = !done && task.deadline_at != null && Date.parse(task.deadline_at) < now;
  const spaceColor = task.space === 'study' ? colors.study : colors.work;
  const countdown = task.deadline_at ? formatCountdown(Date.parse(task.deadline_at), now) : null;
  const priorityColor = task.priority === 1 ? colors.danger : task.priority === 2 ? colors.textMuted : colors.textMuted;
  const a11y = [
    task.title,
    vi.space[task.space],
    collection?.name,
    countdown,
    `${vi.tasks.fields.priority} ${vi.priority[task.priority]}`,
    scheduled ? vi.tasks.scheduled : null,
    task.needs_parse ? vi.quickAdd.unparsedTag : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={[styles.row, selected && { backgroundColor: colors.surface2 }]}>
      <Checkbox checked={done} onChange={onToggle} label={done ? vi.tasks.markTodo : vi.tasks.markDone} color={colors.success} />
      <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} style={styles.body}>
        <AppText variant="body" tone={done ? 'muted' : 'heading'} numberOfLines={2} style={done ? styles.strike : undefined}>
          {task.title}
        </AppText>
        <View style={styles.meta}>
          <View style={[styles.dot, { backgroundColor: spaceColor }]} />
          {collection && (
            <AppText variant="meta" tone="muted" numberOfLines={1} style={styles.shrink}>
              {collection.name}
            </AppText>
          )}
          {countdown && (
            <View style={styles.inline}>
              <Ionicons name={overdue ? 'alert-circle' : 'time-outline'} size={12} color={overdue ? colors.danger : colors.textMuted} />
              <AppText variant="meta" tone={overdue ? 'danger' : 'muted'} numeric>
                {countdown}
              </AppText>
            </View>
          )}
          {task.needs_parse && (
            <AppText variant="meta" tone="warning">
              {vi.quickAdd.unparsedTag}
            </AppText>
          )}
        </View>
      </Pressable>
      <View style={styles.icons}>
        {scheduled && <Ionicons name="calendar" size={16} color={colors.textMuted} accessibilityElementsHidden />}
        <Ionicons name={PRIORITY_ICON[task.priority]} size={18} color={priorityColor} accessibilityElementsHidden />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: touchTarget + 12, borderRadius: 12, paddingRight: spacing.md },
  body: { flex: 1, paddingVertical: spacing.sm, gap: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  icons: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  strike: { textDecorationLine: 'line-through' },
  shrink: { flexShrink: 1, maxWidth: 160 },
});
