/**
 * Calendar — "Lịch". Views: Ngày / 3 ngày / Tuần (week by default on desktop, 3 days on phone).
 * Shows office-hours band, classes, accepted/synced blocks, Google events (grey) and proposed
 * blocks (dashed violet). Blocks move by dragging (web) or long-press + drag (phone); every
 * move is validated with the shared planning engine and pushed to Google. "Đổi giờ" in the
 * block sheet is the accessible alternative.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { Chip } from '../../components/Chip';
import { HeaderIconButton } from '../../components/HeaderIconButton';
import { errorMessage, QueryState } from '../../components/QueryState';
import { SpaceFilterControl } from '../../components/SpaceFilterControl';
import { showToast } from '../../components/Toast';
import { useNow } from '../../hooks/useNow';
import { useResponsive } from '../../hooks/useResponsive';
import { useSync } from '../../hooks/useSync';
import { vi } from '../../i18n/vi';
import { moveBlock } from '../../lib/api/blocks';
import { useCollections, useProposedBlocks } from '../../lib/api/queries';
import type { Task, TaskBlock } from '../../lib/api/types';
import { checkMove } from '../../lib/planning/moves';
import { formatTimeRange } from '../../lib/time/format';
import { classOccurrences, workWindows } from '../../lib/time/slots';
import { addDaysToKey, dateKeyOf, type DateKey, localToInstant, MINUTE, weekdayOfKey } from '../../lib/time/tz';
import { useUiStore } from '../../stores/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing } from '../../theme/tokens';
import { BlockSheet } from './BlockSheet';
import { planTaskOf, usePlanningData } from './usePlanningData';

type View3 = 'day' | 'three' | 'week';
const START_HOUR = 6;
const HOUR_H = 52;
const GUTTER = 44;
const SNAP_MIN = 15;

export function CalendarScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { mode } = useResponsive();
  const filter = useUiStore((s) => s.spaceFilter.calendar);
  const [view, setView] = useState<View3>(mode === 'desktop' ? 'week' : mode === 'twoPane' ? 'week' : 'three');
  const [anchor, setAnchor] = useState<DateKey>(() => dateKeyOf(Date.now()));
  const [selected, setSelected] = useState<{ block: TaskBlock; task: Task } | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const { syncNow, connected } = useSync();
  const clock = useNow();
  const collections = useCollections().data ?? [];

  const days: DateKey[] = useMemo(() => {
    if (view === 'day') return [anchor];
    if (view === 'three') return [anchor, addDaysToKey(anchor, 1), addDaysToKey(anchor, 2)];
    const monday = addDaysToKey(anchor, -((weekdayOfKey(anchor) + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => addDaysToKey(monday, i));
  }, [view, anchor]);

  const range = useMemo(
    () => ({ start: localToInstant(days[0]!, 0), end: localToInstant(addDaysToKey(days[days.length - 1]!, 1), 0) }),
    [days],
  );
  const pd = usePlanningData(range);
  const proposedQ = useProposedBlocks(new Date(range.start).toISOString(), new Date(range.end).toISOString());
  const tz = pd.rules.tz;
  const show = (space: 'study' | 'work') => filter === 'all' || filter === space;

  const office = useMemo(() => (show('work') ? workWindows(pd.ctx) : []), [pd.ctx, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const classes = useMemo(() => (show('study') ? classOccurrences(pd.ctx) : []), [pd.ctx, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const colW = gridWidth > 0 ? (gridWidth - GUTTER) / days.length : 0;
  const dayStart = (key: DateKey) => localToInstant(key, START_HOUR * 60, tz);
  const y = (key: DateKey, t: number) => ((t - dayStart(key)) / (60 * MINUTE)) * HOUR_H;
  const totalH = (24 - START_HOUR) * HOUR_H;

  const step = view === 'day' ? 1 : view === 'three' ? 3 : 7;
  const [yy, mm] = days[0]!.split('-');
  const title = vi.calendar.month(Number(mm), Number(yy));

  /** Validate a drag/drop and persist it. Returns false when the move is invalid. */
  const tryMove = async (block: TaskBlock, task: Task, newStart: number) => {
    const dur = Date.parse(block.end_at) - Date.parse(block.start_at);
    const iv = { start: newStart, end: newStart + dur };
    const res = checkMove(pd.moveContext(new Set([block.id])), planTaskOf(task), iv);
    if (!res.ok) {
      const reason = res.issues.find((i) => i !== 'after_deadline');
      showToast(`${vi.calendar.moveInvalid}: ${reason ? vi.plan.issue[reason] : ''}`, { tone: 'error' });
      return false;
    }
    try {
      await moveBlock(block.id, new Date(iv.start).toISOString(), new Date(iv.end).toISOString());
      showToast(res.issues.includes('after_deadline') ? vi.calendar.afterDeadline : vi.calendar.moved);
      await pd.refetch();
      if (connected) void syncNow({ force: true });
      return true;
    } catch (e) {
      showToast(errorMessage(e), { tone: 'error' });
      return false;
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <AppText variant="screenTitle" accessibilityRole="header">
          {vi.tabs.calendar}
        </AppText>
        <View style={styles.row}>
          <HeaderIconButton icon="chevron-back" label={vi.calendar.prev} onPress={() => setAnchor(addDaysToKey(anchor, -step))} />
          <Chip label={vi.calendar.today} onPress={() => setAnchor(dateKeyOf(clock, tz))} />
          <HeaderIconButton icon="chevron-forward" label={vi.calendar.next} onPress={() => setAnchor(addDaysToKey(anchor, step))} />
        </View>
      </View>
      <View style={styles.controls}>
        <SpaceFilterControl screen="calendar" />
        <View style={styles.row}>
          <AppText variant="secondary" tone="muted" style={styles.flex}>
            {title}
          </AppText>
          {(['day', 'three', 'week'] as const).map((v) => (
            <Chip key={v} label={vi.calendar.views[v]} selected={view === v} onPress={() => setView(v)} />
          ))}
        </View>
      </View>

      <View style={[styles.dayHeader, { borderBottomColor: colors.border }]} onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}>
        <View style={{ width: GUTTER }} />
        {days.map((d) => {
          const isToday = d === dateKeyOf(clock, tz);
          return (
            <Pressable
              key={d}
              accessibilityRole="button"
              onPress={() => (setAnchor(d), setView('day'))}
              style={[styles.dayHead, { width: colW }]}
            >
              <AppText variant="meta" tone={isToday ? 'primary' : 'muted'}>
                {vi.weekdaysShort[weekdayOfKey(d)]}
              </AppText>
              <AppText variant="listTitle" tone={isToday ? 'primary' : 'heading'} numeric>
                {String(Number(d.slice(8)))}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <QueryState isLoading={pd.isLoading} error={pd.error} hasData={!pd.isLoading} onRetry={() => void pd.refetch()}>
        <ScrollView contentContainerStyle={{ paddingBottom: 120 }} contentOffset={{ x: 0, y: (8 - START_HOUR) * HOUR_H }}>
          <View style={{ height: totalH + 16, flexDirection: 'row', paddingTop: 8 }}>
            <View style={{ width: GUTTER }}>
              {Array.from({ length: 24 - START_HOUR }, (_, i) => (
                <AppText key={i} variant="meta" tone="muted" numeric style={[styles.hourLabel, { top: i * HOUR_H - 7 }]}>
                  {`${String(START_HOUR + i).padStart(2, '0')}:00`}
                </AppText>
              ))}
            </View>
            {colW > 0 &&
              days.map((d) => {
                const d0 = dayStart(d);
                const d1 = localToInstant(d, 1440, tz);
                const within = <T extends { start: number; end: number }>(list: T[]) => list.filter((x) => x.end > d0 && x.start < d1);
                const now = clock;
                return (
                  <View key={d} style={[styles.col, { width: colW, height: totalH, borderLeftColor: colors.border }]}>
                    {Array.from({ length: 24 - START_HOUR }, (_, i) => (
                      <View key={i} style={[styles.hourLine, { top: i * HOUR_H, borderTopColor: colors.border }]} />
                    ))}
                    {within(office).map((o, i) => (
                      <View
                        key={`o${i}`}
                        style={[
                          styles.band,
                          {
                            top: y(d, Math.max(o.start, d0)),
                            height: y(d, Math.min(o.end, d1)) - y(d, Math.max(o.start, d0)),
                            backgroundColor: colors.workBand,
                          },
                        ]}
                      />
                    ))}
                    {within(classes).map((c, i) => {
                      const cs = pd.settings?.classSessions.find((s) => s.id === c.classSessionId);
                      const name = collections.find((x) => x.id === cs?.collection_id)?.name ?? vi.today.classTag;
                      return (
                        <StaticBlock
                          key={`c${i}`}
                          top={y(d, c.start)}
                          height={y(d, c.end) - y(d, c.start)}
                          title={`${vi.today.classTag} · ${name}`}
                          range={formatTimeRange(c.start, c.end, tz)}
                          bar={colors.study}
                          fill="rgba(63,182,255,0.28)"
                        />
                      );
                    })}
                    {within(
                      pd.busyRows
                        .filter((b) => !b.all_day)
                        .map((b) => ({ ...b, start: Date.parse(b.start_at), end: Date.parse(b.end_at) })),
                    ).map((b) => (
                      <StaticBlock
                        key={b.id}
                        top={y(d, Math.max(b.start, d0))}
                        height={y(d, Math.min(b.end, d1)) - y(d, Math.max(b.start, d0))}
                        title={b.title ?? vi.today.googleEvent}
                        range={formatTimeRange(b.start, b.end, tz)}
                        bar={colors.external}
                        fill={colors.externalSoft}
                      />
                    ))}
                    {within((proposedQ.data ?? []).map((b) => ({ b, start: Date.parse(b.start_at), end: Date.parse(b.end_at) }))).map(
                      ({ b, start, end }) => {
                        const task = pd.tasksById.get(b.task_id);
                        if (!task || !show(task.space)) return null;
                        return (
                          <Pressable
                            key={b.id}
                            accessibilityRole="button"
                            accessibilityLabel={`${vi.calendar.proposed}: ${task.title}, ${formatTimeRange(start, end, tz)}`}
                            onPress={() => b.proposal_id && router.push({ pathname: '/plan', params: { id: b.proposal_id } })}
                            style={[
                              styles.block,
                              styles.proposed,
                              {
                                top: y(d, start),
                                height: Math.max(22, y(d, end) - y(d, start)),
                                borderColor: colors.primary,
                                backgroundColor: colors.primarySoft,
                              },
                            ]}
                          >
                            <AppText variant="meta" tone="primary" numberOfLines={2}>{`${vi.aiMarker} ${task.title}`}</AppText>
                          </Pressable>
                        );
                      },
                    )}
                    {within(pd.blocks.map((b) => ({ b, start: Date.parse(b.start_at), end: Date.parse(b.end_at) }))).map(
                      ({ b, start, end }) => {
                        const task = pd.tasksById.get(b.task_id);
                        if (!task || !show(task.space)) return null;
                        return (
                          <DraggableBlock
                            key={`${b.id}:${b.start_at}`}
                            block={b}
                            task={task}
                            top={y(d, start)}
                            height={Math.max(24, y(d, end) - y(d, start))}
                            colW={colW}
                            past={end < now}
                            range={formatTimeRange(start, end, tz)}
                            onPress={() => setSelected({ block: b, task })}
                            onDrop={(dxDays, dyMinutes) => {
                              const s = Date.parse(b.start_at);
                              const snapped = Math.round(dyMinutes / SNAP_MIN) * SNAP_MIN;
                              if (dxDays === 0 && snapped === 0) return Promise.resolve(false);
                              const startKey = addDaysToKey(dateKeyOf(s, tz), dxDays);
                              const minutesOfDay = Math.round((s - localToInstant(dateKeyOf(s, tz), 0, tz)) / MINUTE) + snapped;
                              return tryMove(b, task, localToInstant(startKey, minutesOfDay, tz));
                            }}
                          />
                        );
                      },
                    )}
                    {now >= d0 && now < d1 && (
                      <View pointerEvents="none" style={[styles.now, { top: y(d, now), backgroundColor: colors.primary }]} />
                    )}
                  </View>
                );
              })}
          </View>
        </ScrollView>
      </QueryState>

      {selected && (
        <BlockSheet
          block={selected.block}
          task={selected.task}
          planning={pd}
          onClose={() => setSelected(null)}
          onMove={async (start) => {
            const ok = await tryMove(selected.block, selected.task, start);
            if (ok) setSelected(null);
          }}
        />
      )}
    </View>
  );
}

function StaticBlock({
  top,
  height,
  title,
  range,
  bar,
  fill,
}: {
  top: number;
  height: number;
  title: string;
  range: string;
  bar: string;
  fill: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${title}, ${range}`}
      style={[styles.block, { top, height: Math.max(20, height), backgroundColor: fill, borderLeftColor: bar }]}
    >
      <AppText variant="meta" tone="heading" numberOfLines={2}>
        {title}
      </AppText>
    </View>
  );
}

function DraggableBlock({
  block,
  task,
  top,
  height,
  colW,
  past,
  range,
  onPress,
  onDrop,
}: {
  block: TaskBlock;
  task: Task;
  top: number;
  height: number;
  colW: number;
  past: boolean;
  range: string;
  onPress: () => void;
  onDrop: (dxDays: number, dyMinutes: number) => Promise<boolean>;
}) {
  const { colors } = useTheme();
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const last = useRef({ x: 0, y: 0 });
  const space = task.space === 'study' ? { bar: colors.study, fill: colors.studySoft } : { bar: colors.work, fill: colors.workSoft };
  const conflict = block.status === 'conflict';

  const pan = usePanGesture({
    runOnJS: true,
    // Phone: long-press then drag (so scrolling still works); web: drag directly.
    activateAfterLongPress: Platform.OS === 'web' ? 0 : 350,
    minDistance: 4,
    onActivate: () => {
      last.current = { x: 0, y: 0 };
      setDrag({ x: 0, y: 0 });
    },
    onUpdate: (e) => {
      last.current = { x: e.translationX, y: e.translationY };
      setDrag({ x: e.translationX, y: Math.round(((e.translationY / HOUR_H) * 60) / SNAP_MIN) * SNAP_MIN * (HOUR_H / 60) });
    },
    onDeactivate: () => {
      const { x, y: dy } = last.current;
      const dxDays = colW > 0 ? Math.round(x / colW) : 0;
      void onDrop(dxDays, (dy / HOUR_H) * 60).finally(() => setDrag(null));
    },
  });

  return (
    <GestureDetector gesture={pan}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${task.title}, ${range}${conflict ? `, ${vi.block.conflict}` : ''}. ${vi.calendar.dragHint}`}
        onPress={onPress}
        style={[
          styles.block,
          {
            top,
            height,
            backgroundColor: space.fill,
            borderLeftColor: conflict ? colors.danger : space.bar,
            opacity: past ? 0.6 : 1,
            transform: drag ? [{ translateX: drag.x }, { translateY: drag.y }] : [],
            zIndex: drag ? 10 : 1,
          },
          drag && { borderColor: colors.primary, borderWidth: 1 },
          Platform.OS === 'web' && ({ cursor: drag ? 'grabbing' : 'grab' } as object),
        ]}
      >
        <View style={styles.blockTitle}>
          {conflict && <Ionicons name="alert-circle" size={12} color={colors.danger} />}
          {task.status === 'done' && <Ionicons name="checkmark-circle" size={12} color={colors.success} />}
          <AppText variant="meta" tone="heading" numberOfLines={2} style={[styles.flex, task.status === 'done' && styles.strike]}>
            {task.title}
          </AppText>
        </View>
        {height >= 40 && (
          <AppText variant="meta" tone="muted" numeric numberOfLines={1}>
            {range}
          </AppText>
        )}
      </Pressable>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  controls: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.sm },
  dayHeader: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: spacing.xs, marginHorizontal: spacing.sm },
  dayHead: { alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  hourLabel: { position: 'absolute', left: 4 },
  col: { borderLeftWidth: StyleSheet.hairlineWidth, position: 'relative' },
  hourLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: StyleSheet.hairlineWidth },
  band: { position: 'absolute', left: 0, right: 0 },
  block: {
    position: 'absolute',
    left: 2,
    right: 2,
    borderRadius: radius.block,
    borderLeftWidth: 3,
    paddingHorizontal: 4,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  blockTitle: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  proposed: { borderStyle: 'dashed', borderWidth: 1, borderLeftWidth: 1 },
  now: { position: 'absolute', left: 0, right: 0, height: 2 },
  strike: { textDecorationLine: 'line-through' },
});
