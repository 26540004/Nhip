/**
 * "AI đề xuất" — the user stays in control: nothing reaches Google Calendar without approval.
 * Header summary (✦ AI), warnings (computed by code), proposals grouped by day with
 * ✓ Đồng ý · ✎ Sửa giờ (only valid slots) · ✕ Bỏ, sticky "Thêm N khối vào Google Calendar",
 * secondary "Đồng ý tất cả". After applying: toast with "Hoàn tác" for 10 s.
 */
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { HeaderIconButton } from '../../components/HeaderIconButton';
import { errorMessage, QueryState } from '../../components/QueryState';
import { showToast } from '../../components/Toast';
import { useSync } from '../../hooks/useSync';
import { vi } from '../../i18n/vi';
import { applyProposal, type Decision, markProposalReviewed, undoApply } from '../../lib/api/blocks';
import { useProposal } from '../../lib/api/queries';
import type { TaskBlock } from '../../lib/api/types';
import { checkMove, slotOptions } from '../../lib/planning/moves';
import { formatDayHeader, formatDurationLong, formatTimeRange } from '../../lib/time/format';
import { addDaysToKey, dateKeyOf, localToInstant, MINUTE } from '../../lib/time/tz';
import { useTheme } from '../../theme/ThemeProvider';
import { motion, radius, spacing, touchTarget } from '../../theme/tokens';
import { planTaskOf, usePlanningData } from '../calendar/usePlanningData';

type Choice = 'pending' | 'accepted' | 'rejected';
interface Draft {
  choice: Choice;
  start: number;
  end: number;
}

export function PlanReviewScreen({ proposalId }: { proposalId: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const q = useProposal(proposalId);
  const { connected, syncNow } = useSync();
  const proposal = q.data?.proposal;
  const blocks = useMemo(() => (q.data?.blocks ?? []).filter((b) => b.status === 'proposed'), [q.data]);

  const [openedAt] = useState(() => Date.now());
  const range = useMemo(
    () => ({
      start: proposal ? Date.parse(proposal.range_start) : openedAt,
      end: proposal ? Date.parse(proposal.range_end) + 86_400_000 : openedAt + 86_400_000,
    }),
    [proposal, openedAt],
  );
  const pd = usePlanningData(range);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [editing, setEditing] = useState<{ id: string; day: string } | null>(null);
  const [applying, setApplying] = useState(false);

  const draftOf = (b: TaskBlock): Draft => drafts[b.id] ?? { choice: 'pending', start: Date.parse(b.start_at), end: Date.parse(b.end_at) };
  const setDraft = (id: string, patch: Partial<Draft>, b: TaskBlock) => setDrafts((d) => ({ ...d, [id]: { ...draftOf(b), ...patch } }));
  const acceptedCount = blocks.filter((b) => draftOf(b).choice === 'accepted').length;
  const replaces = proposal?.request_context_json.replaces_block_ids ?? [];
  const report = proposal?.validation_report_json;

  const byDay = useMemo(() => {
    const m = new Map<string, TaskBlock[]>();
    for (const b of blocks) {
      const key = dateKeyOf(drafts[b.id]?.start ?? Date.parse(b.start_at), pd.rules.tz);
      m.set(key, [...(m.get(key) ?? []), b]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [blocks, drafts, pd.rules.tz]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const apply = async (all: boolean) => {
    const decisions: Decision[] = blocks.map((b) => {
      const d = draftOf(b);
      const accept = all ? d.choice !== 'rejected' : d.choice === 'accepted';
      const moved = d.start !== Date.parse(b.start_at) || d.end !== Date.parse(b.end_at);
      return { id: b.id, accept, ...(moved ? { start_at: new Date(d.start).toISOString(), end_at: new Date(d.end).toISOString() } : {}) };
    });
    const n = decisions.filter((d) => d.accept).length;
    if (n === 0) {
      showToast(vi.review.nothingSelected);
      return;
    }
    // The calendar may have changed since the proposal was made: re-check every accepted
    // block against the current state (and against each other) before writing anything.
    const placed: { taskId: string; space: 'study' | 'work'; start: number; end: number }[] = [];
    for (const d of decisions.filter((x) => x.accept)) {
      const b = blocks.find((x) => x.id === d.id)!;
      const task = pd.tasksById.get(b.task_id);
      if (!task) continue;
      const iv = {
        start: d.start_at ? Date.parse(d.start_at) : Date.parse(b.start_at),
        end: d.end_at ? Date.parse(d.end_at) : Date.parse(b.end_at),
      };
      const res = checkMove(pd.moveContext(new Set(replaces), placed), planTaskOf(task), iv);
      if (!res.ok) {
        const reason = res.issues.find((i) => i !== 'after_deadline');
        showToast(vi.review.stale(task.title, reason ? vi.plan.issue[reason] : ''), { tone: 'error', durationMs: 6000 });
        setEditing({ id: b.id, day: dateKeyOf(iv.start, pd.rules.tz) });
        return;
      }
      placed.push({ taskId: task.id, space: task.space, start: iv.start, end: iv.end });
    }
    setApplying(true);
    try {
      const { accepted } = await applyProposal(proposalId, decisions, replaces);
      if (connected) await syncNow({ force: true });
      await qc.invalidateQueries();
      showToast(vi.review.applied(n), {
        durationMs: 10_000,
        action: {
          label: vi.review.undo,
          onPress: () =>
            void (async () => {
              try {
                await undoApply(proposalId, accepted, replaces);
                if (connected) await syncNow({ force: true });
                await qc.invalidateQueries();
                showToast(vi.review.undone);
              } catch (e) {
                showToast(errorMessage(e), { tone: 'error' });
              }
            })(),
        },
      });
      close();
    } catch (e) {
      showToast(errorMessage(e), { tone: 'error' });
    } finally {
      setApplying(false);
    }
  };

  const dismiss = async () => {
    if (proposal?.status === 'pending') await markProposalReviewed(proposalId).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ['proposedBlocks'] });
    close();
  };

  const editingBlock = editing ? blocks.find((b) => b.id === editing.id) : undefined;
  const editingOptions = useMemo(() => {
    if (!editing || !editingBlock) return [];
    const task = pd.tasksById.get(editingBlock.task_id);
    if (!task) return [];
    const d = draftOf(editingBlock);
    const minutes = Math.round((d.end - d.start) / MINUTE);
    // Other accepted proposals occupy time too.
    const extra = blocks
      .filter((b) => b.id !== editingBlock.id && draftOf(b).choice !== 'rejected')
      .map((b) => {
        const t = pd.tasksById.get(b.task_id);
        const dd = draftOf(b);
        return { taskId: b.task_id, space: t?.space ?? 'work', start: dd.start, end: dd.end };
      });
    const window = { start: localToInstant(editing.day, 0, pd.rules.tz), end: localToInstant(editing.day, 1440, pd.rules.tz) };
    return slotOptions(pd.moveContext(new Set(replaces), extra), planTaskOf(task), minutes, window);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, editingBlock, drafts, pd.ctx]);

  let index = 0;
  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <AppText variant="screenTitle" accessibilityRole="header">
          {vi.review.title}
        </AppText>
        <HeaderIconButton icon="close" label={vi.common.close} onPress={() => void dismiss()} />
      </View>
      <QueryState isLoading={q.isLoading} error={q.error} hasData={q.data != null} onRetry={() => void q.refetch()}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 160 + insets.bottom }]}>
          {proposal && (
            <AppText variant="secondary" tone="muted" numeric>
              {`${formatDayHeader(dateKeyOf(Date.parse(proposal.range_start), pd.rules.tz))} → ${formatDayHeader(
                dateKeyOf(Date.parse(proposal.range_end) - 1, pd.rules.tz),
              )}`}
            </AppText>
          )}
          {report && (
            <Card ai>
              <AppText variant="meta" tone="primary">
                {vi.aiMarker}
              </AppText>
              <AppText variant="body" tone="heading">
                {report.summary}
              </AppText>
              {report.notice && (
                <AppText variant="secondary" tone="warning">
                  {report.notice}
                </AppText>
              )}
              {replaces.length > 0 && (
                <AppText variant="secondary" tone="muted">
                  {vi.review.replaces(replaces.length)}
                </AppText>
              )}
            </Card>
          )}

          {report && report.warnings.length > 0 && (
            <View style={styles.section} accessibilityRole="summary">
              <AppText variant="listTitle">{vi.review.warnings}</AppText>
              {report.warnings.map((w, i) => (
                <View
                  key={i}
                  style={[
                    styles.warning,
                    {
                      backgroundColor: colors.surface,
                      borderColor: w.kind === 'cannot_fit' || w.kind === 'overload' ? colors.danger : colors.warning,
                    },
                  ]}
                >
                  <Ionicons
                    name={w.kind === 'cannot_fit' || w.kind === 'overload' ? 'warning' : 'alert-circle-outline'}
                    size={18}
                    color={w.kind === 'cannot_fit' || w.kind === 'overload' ? colors.danger : colors.warning}
                  />
                  <AppText variant="secondary" style={styles.flex}>
                    {w.message}
                  </AppText>
                </View>
              ))}
            </View>
          )}

          {proposal?.status === 'applied' && (
            <AppText variant="secondary" tone="muted">
              {vi.review.alreadyApplied}
            </AppText>
          )}
          {blocks.length === 0 && proposal?.status !== 'applied' && <EmptyState icon="calendar-outline" title={vi.review.empty} />}

          {byDay.map(([day, list]) => (
            <View key={day} style={styles.section}>
              <AppText variant="section" accessibilityRole="header">
                {formatDayHeader(day)}
              </AppText>
              {list
                .sort((a, b) => draftOf(a).start - draftOf(b).start)
                .map((b) => {
                  const d = draftOf(b);
                  const task = pd.tasksById.get(b.task_id);
                  const spaceColor = task?.space === 'study' ? colors.study : colors.work;
                  const delay = index++ * motion.proposalStaggerMs;
                  const isEditing = editing?.id === b.id;
                  return (
                    <Animated.View key={b.id} entering={FadeInDown.delay(delay).duration(220).reduceMotion(ReduceMotion.System)}>
                      <View
                        style={[
                          styles.card,
                          {
                            backgroundColor: d.choice === 'accepted' ? colors.primarySoft : colors.surface,
                            borderColor: d.choice === 'accepted' ? colors.primary : colors.border,
                            opacity: d.choice === 'rejected' ? 0.5 : 1,
                          },
                        ]}
                      >
                        <View style={[styles.bar, { backgroundColor: spaceColor }]} />
                        <View style={styles.cardBody}>
                          <AppText variant="listTitle" numberOfLines={2} style={d.choice === 'rejected' ? styles.strike : undefined}>
                            {task?.title ?? '—'}
                          </AppText>
                          <AppText variant="secondary" numeric>
                            {`${formatTimeRange(d.start, d.end, pd.rules.tz)} · ${formatDurationLong(Math.round((d.end - d.start) / MINUTE))}`}
                          </AppText>
                          {b.reason ? (
                            <AppText variant="meta" tone="muted">
                              {`${vi.review.why}: ${b.reason}`}
                            </AppText>
                          ) : null}
                          <View style={styles.actions}>
                            <ActionChip
                              icon={d.choice === 'accepted' ? 'checkmark-circle' : 'checkmark'}
                              label={d.choice === 'accepted' ? vi.review.accepted : vi.review.accept}
                              selected={d.choice === 'accepted'}
                              onPress={() => setDraft(b.id, { choice: d.choice === 'accepted' ? 'pending' : 'accepted' }, b)}
                            />
                            <ActionChip
                              icon="create-outline"
                              label={vi.review.edit}
                              selected={isEditing}
                              onPress={() => setEditing(isEditing ? null : { id: b.id, day: dateKeyOf(d.start, pd.rules.tz) })}
                            />
                            <ActionChip
                              icon="close"
                              label={d.choice === 'rejected' ? vi.review.rejected : vi.review.reject}
                              selected={d.choice === 'rejected'}
                              onPress={() => setDraft(b.id, { choice: d.choice === 'rejected' ? 'pending' : 'rejected' }, b)}
                            />
                          </View>
                          {isEditing && editing && (
                            <View style={styles.picker}>
                              <AppText variant="meta" tone="muted">
                                {vi.review.pickTime}
                              </AppText>
                              <View style={styles.wrap}>
                                {[-1, 0, 1]
                                  .map((off) => addDaysToKey(dateKeyOf(d.start, pd.rules.tz), off))
                                  .filter((key) => key >= dateKeyOf(pd.now, pd.rules.tz))
                                  .map((key) => {
                                    return (
                                      <Chip
                                        key={key}
                                        label={formatDayHeader(key)}
                                        selected={editing.day === key}
                                        onPress={() => setEditing({ id: b.id, day: key })}
                                      />
                                    );
                                  })}
                              </View>
                              {editingOptions.length === 0 ? (
                                <AppText variant="secondary" tone="warning">
                                  {vi.review.noValidSlots}
                                </AppText>
                              ) : (
                                <View style={styles.wrap}>
                                  {editingOptions.map((o) => (
                                    <Chip
                                      key={o.start}
                                      label={formatTimeRange(o.start, o.end, pd.rules.tz)}
                                      selected={o.start === d.start}
                                      onPress={() => {
                                        setDraft(b.id, { start: o.start, end: o.end, choice: 'accepted' }, b);
                                        setEditing(null);
                                      }}
                                    />
                                  ))}
                                </View>
                              )}
                            </View>
                          )}
                        </View>
                      </View>
                    </Animated.View>
                  );
                })}
            </View>
          ))}
        </ScrollView>

        {blocks.length > 0 && proposal?.status !== 'applied' && (
          <View
            style={[
              styles.sticky,
              { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, spacing.md) },
            ]}
          >
            <Button
              label={connected ? vi.review.applyGoogle(acceptedCount) : vi.review.applyLocal(acceptedCount)}
              onPress={() => void apply(false)}
              loading={applying}
              disabled={acceptedCount === 0 || applying}
              style={styles.flex}
            />
            <Button label={vi.review.acceptAll} variant="secondary" onPress={() => void apply(true)} disabled={applying} />
          </View>
        )}
      </QueryState>
    </View>
  );
}

function ActionChip({
  icon,
  label,
  onPress,
  selected,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.action,
        { backgroundColor: selected ? colors.primarySoft : colors.surface2, borderColor: selected ? colors.primary : 'transparent' },
      ]}
    >
      <Ionicons name={icon} size={16} color={selected ? colors.primary : colors.textBody} />
      <AppText variant="secondary" style={{ color: selected ? colors.primary : colors.textBody }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg, width: '100%', maxWidth: 820, alignSelf: 'center' },
  section: { gap: spacing.md },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: radius.input,
    borderWidth: 1,
    padding: spacing.md,
  },
  card: { flexDirection: 'row', borderRadius: radius.card, borderWidth: 1, overflow: 'hidden' },
  bar: { width: 3 },
  cardBody: { flex: 1, padding: spacing.lg, gap: spacing.xs + 2 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget - 4,
    paddingHorizontal: spacing.md,
    borderRadius: radius.chip,
    borderWidth: 1,
  },
  picker: { gap: spacing.sm, marginTop: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  strike: { textDecorationLine: 'line-through' },
  sticky: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
  },
});
