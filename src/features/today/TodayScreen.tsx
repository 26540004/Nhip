/**
 * Today — "What should I do today, and is today realistic?"
 * Capacity bars per space, timeline (office-hours band, classes, task blocks, Google events,
 * now line) and "Chưa xếp lịch" (today's and overdue tasks without a block).
 * The "✦ AI xếp lịch" button and "Cân bằng lại" arrive with propose-plan in Phase 3.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { CapacityBar } from '../../components/CapacityBar';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import { DayTimeline, type TimelineItem } from '../../components/DayTimeline';
import { EmptyState } from '../../components/EmptyState';
import { QueryState } from '../../components/QueryState';
import { Screen } from '../../components/Screen';
import { SpaceFilterControl } from '../../components/SpaceFilterControl';
import { TaskRow } from '../../components/TaskRow';
import { useNow } from '../../hooks/useNow';
import { useSync } from '../../hooks/useSync';
import { MorningBriefCard, NotificationPromptCard } from '../brief/TodayCards';
import { AiPlanButton } from '../plan/AiPlanButton';
import { useStartPlan } from '../plan/useStartPlan';
import { vi } from '../../i18n/vi';
import { completionPatch, usePendingSyncCount, useUpdateTask } from '../../lib/api/mutations';
import { useBlocks, useBusy, useCollections, useSettings, useTasks } from '../../lib/api/queries';
import { isDemo } from '../../lib/api/supabase';
import type { Task, TaskBlock } from '../../lib/api/types';
import { computeLoads } from '../../lib/planning/capacity';
import { rulesFromSettings } from '../../lib/settings/rules';
import { unscheduledForToday } from '../../lib/tasks/grouping';
import { formatDayHeader } from '../../lib/time/format';
import { classOccurrences, type SlotContext, workWindows } from '../../lib/time/slots';
import { dateKeyOf, localToInstant } from '../../lib/time/tz';
import { useUiStore } from '../../stores/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing, touchTarget } from '../../theme/tokens';

export function TodayScreen() {
  const { colors } = useTheme();
  const now = useNow();
  const filter = useUiStore((s) => s.spaceFilter.today);
  const demoDismissed = useUiStore((s) => s.demoBannerDismissed);
  const dismissDemo = useUiStore((s) => s.dismissDemoBanner);
  const settings = useSettings();
  const rules = useMemo(() => rulesFromSettings(settings.data), [settings.data]);
  const today = dateKeyOf(now, rules.tz);
  const dayStart = localToInstant(today, 0, rules.tz);
  const dayEnd = localToInstant(today, 1440, rules.tz);
  const fromIso = new Date(dayStart).toISOString();
  const toIso = new Date(dayEnd).toISOString();

  const tasksQ = useTasks();
  const blocksQ = useBlocks(fromIso, toIso);
  const busyQ = useBusy(fromIso, toIso);
  const collections = useCollections().data ?? [];
  const update = useUpdateTask();
  const pending = usePendingSyncCount();
  const sync = useSync();
  const plan = useStartPlan();

  const tasks = useMemo(() => tasksQ.data ?? [], [tasksQ.data]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const show = (space: 'study' | 'work') => filter === 'all' || filter === space;

  const ctx: SlotContext = {
    tz: rules.tz,
    range: { start: dayStart, end: dayEnd },
    workHours: rules.workHours,
    studyWindows: rules.studyWindows,
    classSessions: rules.classSessions,
    exceptions: rules.exceptions,
    busy: [],
  };

  const blocks = blocksQ.data ?? [];
  const spacedBlocks: { b: TaskBlock; task: Task }[] = [];
  for (const b of blocks) {
    const task = taskById.get(b.task_id);
    if (task) spacedBlocks.push({ b, task });
  }

  const loads = computeLoads(
    spacedBlocks.map(({ b, task }) => ({ space: task.space, start: Date.parse(b.start_at), end: Date.parse(b.end_at) })),
    rules.capacity,
    [today],
    rules.tz,
  ).filter((l) => l.date === today && show(l.space) && (l.maxMinutes > 0 || l.usedMinutes > 0));

  const items: TimelineItem[] = [
    ...(show('study')
      ? classOccurrences(ctx).map((o, i) => {
          const session = settings.data?.classSessions.find((c) => c.id === o.classSessionId);
          const name = collections.find((c) => c.id === session?.collection_id)?.name ?? vi.today.classTag;
          return { id: `class-${i}`, kind: 'class' as const, title: name, start: o.start, end: o.end };
        })
      : []),
    ...spacedBlocks
      .filter(({ task }) => show(task.space))
      .map(({ b, task }) => ({
        id: b.id,
        kind: 'block' as const,
        space: task.space,
        title: task.title,
        start: Date.parse(b.start_at),
        end: Date.parse(b.end_at),
        onPress: () => router.push({ pathname: '/task/[id]', params: { id: task.id } }),
      })),
    ...(busyQ.data ?? [])
      .filter((e) => !e.all_day)
      .map((e) => ({
        id: e.id,
        kind: 'external' as const,
        title: e.title ?? vi.today.googleEvent,
        start: Date.parse(e.start_at),
        end: Date.parse(e.end_at),
      })),
  ];

  const scheduledIds = new Set(blocks.map((b) => b.task_id));
  const unscheduled = unscheduledForToday(tasks, scheduledIds, now, rules.tz).filter((t) => show(t.space));
  const officeBand = show('work') ? workWindows(ctx) : [];

  return (
    <Screen
      title={formatDayHeader(today)}
      onRefresh={() => {
        void sync.syncNow({ force: true });
        void Promise.all([tasksQ.refetch(), blocksQ.refetch(), busyQ.refetch()]);
      }}
      refreshing={tasksQ.isRefetching}
      footer={<AiPlanButton />}
      right={
        <View style={styles.inline}>
          {pending > 0 && <Chip label={`${vi.states.pendingSync} · ${pending}`} icon="cloud-upload-outline" tone="warning" />}
          {sync.connected && <SyncDot state={sync.state} />}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={vi.tabs.settings}
            onPress={() => router.push('/settings')}
            style={[styles.avatar, { backgroundColor: colors.surface2, borderColor: colors.border }]}
          >
            <Ionicons name="person-outline" size={20} color={colors.textBody} />
          </Pressable>
        </View>
      }
    >
      {isDemo && !demoDismissed && (
        <Card ai>
          <AppText variant="meta" tone="primary">
            {vi.demo.tag}
          </AppText>
          <AppText variant="secondary">{vi.demo.banner}</AppText>
          <Button label={vi.demo.gotIt} variant="secondary" onPress={dismissDemo} />
        </Card>
      )}
      <NotificationPromptCard />
      <MorningBriefCard />
      <SpaceFilterControl screen="today" />

      <QueryState isLoading={tasksQ.isLoading} error={tasksQ.error} hasData={tasksQ.data != null} onRetry={() => void tasksQ.refetch()}>
        {loads.length > 0 && (
          <Card>
            {loads.map((l) => (
              <CapacityBar key={`${l.date}-${l.space}`} load={l} onRebalance={() => void plan.start({ rebalance_date: today })} />
            ))}
          </Card>
        )}

        <View style={styles.section}>
          <DayTimeline date={today} officeHours={officeBand} items={items} now={now} tz={rules.tz} />
        </View>

        <View style={styles.section}>
          <AppText variant="section" accessibilityRole="header">
            {vi.today.unscheduled}
          </AppText>
          {unscheduled.length === 0 ? (
            <EmptyState icon="sunny-outline" title={vi.today.empty} />
          ) : (
            unscheduled.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                collection={collections.find((c) => c.id === t.collection_id)}
                now={now}
                onPress={() => router.push({ pathname: '/task/[id]', params: { id: t.id } })}
                onToggle={(done) => update.mutate({ id: t.id, patch: completionPatch(done) })}
              />
            ))
          )}
        </View>
      </QueryState>
    </Screen>
  );
}

/** Google sync status: green synced, amber syncing, red error (tap to fix). Icon + label for VoiceOver. */
function SyncDot({ state }: { state: 'idle' | 'syncing' | 'error' }) {
  const { colors } = useTheme();
  const color = state === 'error' ? colors.danger : state === 'syncing' ? colors.warning : colors.success;
  const label = state === 'error' ? vi.today.sync.error : state === 'syncing' ? vi.today.sync.syncing : vi.today.sync.ok;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push('/settings/google')}
      hitSlop={8}
      style={styles.dotWrap}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dotWrap: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  section: { gap: spacing.md },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: touchTarget / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
