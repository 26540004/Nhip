/**
 * Tasks — "Việc". Groups: Quá hạn · Hôm nay · Tuần này · Sau đó · Không có hạn · Đã xong (collapsed).
 * Filters: space (shared segmented control), collection, priority; sort by deadline or priority.
 * ≥ 768 px: list + detail side by side.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { Chip } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { HeaderIconButton } from '../../components/HeaderIconButton';
import { QueryState } from '../../components/QueryState';
import { SpaceFilterControl } from '../../components/SpaceFilterControl';
import { TaskRow } from '../../components/TaskRow';
import { useNow } from '../../hooks/useNow';
import { useResponsive } from '../../hooks/useResponsive';
import { vi } from '../../i18n/vi';
import { completionPatch, usePendingSyncCount, useUpdateTask } from '../../lib/api/mutations';
import { useBlocks, useCollections, useTasks } from '../../lib/api/queries';
import type { Task } from '../../lib/api/types';
import { filterTasks, groupTasks, type SortMode, type TaskGroupKey } from '../../lib/tasks/grouping';
import { useUiStore } from '../../stores/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';
import { TaskDetail } from './TaskDetail';

type Row = { type: 'header'; key: TaskGroupKey; count: number } | { type: 'task'; task: Task };

export function TasksScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { mode } = useResponsive();
  const now = useNow();
  const space = useUiStore((s) => s.spaceFilter.tasks);
  const tasksQ = useTasks();
  const collections = useCollections().data ?? [];
  const update = useUpdateTask();
  const pending = usePendingSyncCount();
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [priority, setPriority] = useState<1 | 2 | 3 | null>(null);
  const [sort, setSort] = useState<SortMode>('deadline');
  const [showDone, setShowDone] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const split = mode !== 'phone';

  // Calendar icon for tasks that have accepted/synced blocks in the coming weeks.
  const [blockRange] = useState(() => ({
    from: new Date(Date.now() - 86_400_000).toISOString(),
    to: new Date(Date.now() + 60 * 86_400_000).toISOString(),
  }));
  const blocks = useBlocks(blockRange.from, blockRange.to).data;
  const scheduledIds = useMemo(() => new Set((blocks ?? []).map((b) => b.task_id)), [blocks]);
  const allTasks = useMemo(() => tasksQ.data ?? [], [tasksQ.data]);
  const visible = useMemo(() => filterTasks(allTasks, { space, collectionId, priority }), [allTasks, space, collectionId, priority]);
  const groups = useMemo(() => groupTasks(visible, now, { sort }), [visible, now, sort]);
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const g of groups) {
      out.push({ type: 'header', key: g.key, count: g.tasks.length });
      if (g.key === 'done' && !showDone) continue;
      for (const t of g.tasks) out.push({ type: 'task', task: t });
    }
    return out;
  }, [groups, showDone]);

  const colOptions = collections.filter((c) => !c.archived && (space === 'all' || c.space === space));
  const open = (id: string) => (split ? setSelected(id) : router.push({ pathname: '/task/[id]', params: { id } }));

  const list = (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <AppText variant="screenTitle" accessibilityRole="header">
          {vi.tabs.tasks}
        </AppText>
        <View style={styles.inline}>
          {pending > 0 && <Chip label={`${vi.states.pendingSync} · ${pending}`} icon="cloud-upload-outline" tone="warning" />}
          <HeaderIconButton icon="search" label={vi.search.placeholder} onPress={() => router.push('/search')} />
          <HeaderIconButton
            icon="add"
            label={vi.tasks.newTask}
            onPress={() => (split ? setSelected('new') : router.push({ pathname: '/task/[id]', params: { id: 'new' } }))}
          />
        </View>
      </View>
      <View style={styles.controls}>
        <SpaceFilterControl screen="tasks" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip
            label={sort === 'deadline' ? vi.tasks.sort.deadline : vi.tasks.sort.priority}
            icon="swap-vertical"
            onPress={() => setSort(sort === 'deadline' ? 'priority' : 'deadline')}
          />
          {([1, 2, 3] as const).map((p) => (
            <Chip key={p} label={vi.priority[p]} selected={priority === p} onPress={() => setPriority(priority === p ? null : p)} />
          ))}
          <Chip label={vi.tasks.filterAllCollections} selected={collectionId == null} onPress={() => setCollectionId(null)} />
          {colOptions.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              tone={c.space}
              selected={collectionId === c.id}
              onPress={() => setCollectionId(collectionId === c.id ? null : c.id)}
            />
          ))}
        </ScrollView>
      </View>
      <QueryState isLoading={tasksQ.isLoading} error={tasksQ.error} hasData={tasksQ.data != null} onRetry={() => void tasksQ.refetch()}>
        {rows.length === 0 ? (
          <EmptyState icon="checkbox-outline" title={allTasks.length === 0 ? vi.tasks.empty : vi.tasks.emptyFiltered} />
        ) : (
          <FlashList
            data={rows}
            keyExtractor={(r) => (r.type === 'header' ? `h-${r.key}` : r.task.id)}
            getItemType={(r) => r.type}
            onRefresh={() => void tasksQ.refetch()}
            refreshing={tasksQ.isRefetching}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 120 }}
            renderItem={({ item }) =>
              item.type === 'header' ? (
                <Pressable
                  disabled={item.key !== 'done'}
                  accessibilityRole={item.key === 'done' ? 'button' : 'header'}
                  accessibilityState={item.key === 'done' ? { expanded: showDone } : undefined}
                  onPress={() => setShowDone((v) => !v)}
                  style={styles.groupHeader}
                >
                  <AppText variant="secondary" tone={item.key === 'overdue' ? 'danger' : 'muted'} style={styles.groupTitle}>
                    {`${vi.tasks.groups[item.key]} · ${item.count}`}
                  </AppText>
                  {item.key === 'done' && <Ionicons name={showDone ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />}
                </Pressable>
              ) : (
                <TaskRow
                  task={item.task}
                  collection={collections.find((c) => c.id === item.task.collection_id)}
                  scheduled={scheduledIds.has(item.task.id)}
                  now={now}
                  selected={split && selected === item.task.id}
                  onPress={() => open(item.task.id)}
                  onToggle={(done) => update.mutate({ id: item.task.id, patch: completionPatch(done) })}
                />
              )
            }
          />
        )}
      </QueryState>
    </View>
  );

  if (!split) return <View style={[styles.flex, { backgroundColor: colors.bg }]}>{list}</View>;
  return (
    <View style={[styles.split, { backgroundColor: colors.bg }]}>
      <View style={[styles.listPane, { borderRightColor: colors.border }]}>{list}</View>
      <View style={[styles.flex, { paddingTop: insets.top + spacing.sm }]}>
        {selected ? (
          <TaskDetail key={selected} taskId={selected} onClose={() => setSelected(null)} />
        ) : (
          <EmptyState icon="checkbox-outline" title={vi.tabs.tasks} body={vi.tasks.empty} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  split: { flex: 1, flexDirection: 'row' },
  listPane: { width: 420, borderRightWidth: 1 },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  controls: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.sm },
  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    minHeight: 36,
  },
  groupTitle: { fontFamily: 'Inter_600SemiBold' },
});
