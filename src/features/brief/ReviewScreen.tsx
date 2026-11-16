/**
 * Evening review (/review, opened from the 21:30 notification).
 * Per unfinished item: Xong · Dời sang mai · ✦ Để AI xếp lại · Bỏ.
 * Asks how long finished tasks really took (→ actual_minutes, improves future estimates).
 * Ends with "✦ Xếp lại các việc đã dời" → propose-plan for those tasks.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { buildReview } from '../../../supabase/functions/_shared/brief-core.ts';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { HeaderIconButton } from '../../components/HeaderIconButton';
import { errorMessage, QueryState } from '../../components/QueryState';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { showToast } from '../../components/Toast';
import { useSync } from '../../hooks/useSync';
import { vi } from '../../i18n/vi';
import { dropBlock } from '../../lib/api/blocks';
import { completionPatch, useUpdateTask } from '../../lib/api/mutations';
import { formatDayHeader } from '../../lib/time/format';
import { addDaysToKey, dateKeyOf, hhmmOf, localToInstant } from '../../lib/time/tz';
import { spacing } from '../../theme/tokens';
import { useStartPlan } from '../plan/useStartPlan';
import { useBriefInput } from './useBriefData';

type Outcome = 'done' | 'tomorrow' | 'replan' | 'dropped';

export function ReviewScreen() {
  const qc = useQueryClient();
  const { input, ready, refetch } = useBriefInput();
  // Freeze the list when the screen opens so handled items stay visible with their outcome.
  const [snapshot, setSnapshot] = useState<ReturnType<typeof buildReview> | null>(null);
  const review = snapshot ?? (ready ? buildReview(input) : null);
  if (ready && !snapshot && review) setSnapshot(review);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const update = useUpdateTask();
  const plan = useStartPlan();
  const { connected, syncNow } = useSync();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const tz = input.tz;

  const act = async (taskId: string, blockIds: string[], outcome: Outcome) => {
    try {
      const task = input.tasks.find((t) => t.id === taskId);
      if (outcome === 'done') update.mutate({ id: taskId, patch: completionPatch(true) });
      if (outcome === 'tomorrow' || outcome === 'replan' || outcome === 'dropped') {
        for (const b of blockIds) await dropBlock(b);
      }
      if (outcome === 'tomorrow' && task?.deadline_at && dateKeyOf(Date.parse(task.deadline_at), tz) <= dateKeyOf(input.now, tz)) {
        const dl = Date.parse(task.deadline_at);
        const next = localToInstant(addDaysToKey(dateKeyOf(input.now, tz), 1), hhmmOf(dl, tz), tz);
        update.mutate({ id: taskId, patch: { deadline_at: new Date(next).toISOString() } });
      }
      if (outcome === 'dropped') update.mutate({ id: taskId, patch: { status: 'dropped', completed_at: null } });
      setOutcomes((o) => ({ ...o, [taskId]: outcome }));
      if (blockIds.length && connected) void syncNow({ force: true });
      void qc.invalidateQueries({ queryKey: ['blocks'] });
    } catch (e) {
      showToast(errorMessage(e), { tone: 'error' });
    }
  };

  const toReplan = Object.entries(outcomes)
    .filter(([, o]) => o === 'tomorrow' || o === 'replan')
    .map(([id]) => id);
  const label: Record<Outcome, string> = {
    done: vi.evening.done,
    tomorrow: vi.evening.movedTomorrow,
    replan: vi.evening.queued,
    dropped: vi.evening.dropped,
  };

  return (
    <Screen title={vi.evening.title} right={<HeaderIconButton icon="close" label={vi.common.close} onPress={close} />}>
      <AppText variant="secondary" tone="muted">
        {formatDayHeader(dateKeyOf(input.now, tz))}
      </AppText>
      <QueryState isLoading={!review} error={null} hasData={Boolean(review)} onRetry={refetch}>
        {review && (
          <>
            <Card ai>
              <AppText variant="body" tone="heading">
                {review.summary}
              </AppText>
            </Card>

            {review.items.length === 0 ? (
              <EmptyState icon="moon-outline" title={vi.evening.allClear} />
            ) : (
              <View style={styles.section}>
                <AppText variant="section">{vi.evening.unfinished}</AppText>
                {review.items.map((it) => {
                  const o = outcomes[it.taskId];
                  return (
                    <Card key={it.taskId}>
                      <AppText variant="listTitle" style={o ? styles.muted : undefined}>
                        {it.title}
                      </AppText>
                      {o ? (
                        <Chip label={`${vi.evening.handled}: ${label[o]}`} icon="checkmark" tone="primary" />
                      ) : (
                        <View style={styles.actions}>
                          <Chip
                            label={vi.evening.done}
                            icon="checkmark-circle-outline"
                            onPress={() => void act(it.taskId, it.blockIds, 'done')}
                          />
                          <Chip
                            label={vi.evening.tomorrow}
                            icon="arrow-forward-circle-outline"
                            onPress={() => void act(it.taskId, it.blockIds, 'tomorrow')}
                          />
                          <Chip label={vi.evening.aiReplan} tone="primary" onPress={() => void act(it.taskId, it.blockIds, 'replan')} />
                          <Chip label={vi.evening.drop} icon="close" onPress={() => void act(it.taskId, it.blockIds, 'dropped')} />
                        </View>
                      )}
                    </Card>
                  );
                })}
              </View>
            )}

            {review.doneToday
              .filter((t) => t.estimate_minutes != null)
              .slice(0, 3)
              .map((t) => (
                <TextField
                  key={t.id}
                  label={vi.evening.actualQuestion(t.title)}
                  hint={vi.evening.actualHint}
                  keyboardType="number-pad"
                  value={actuals[t.id] ?? ''}
                  placeholder={String(t.estimate_minutes)}
                  onChangeText={(v) => setActuals((a) => ({ ...a, [t.id]: v.replace(/[^\d]/g, '') }))}
                  onBlur={() => {
                    const n = Number(actuals[t.id]);
                    if (n > 0) update.mutate({ id: t.id, patch: { actual_minutes: n } });
                  }}
                />
              ))}

            {toReplan.length > 0 && (
              <Button
                label={vi.evening.replanAll(toReplan.length)}
                variant="ai"
                loading={plan.busy}
                onPress={() => void plan.start({ task_ids: toReplan })}
              />
            )}
          </>
        )}
      </QueryState>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  muted: { opacity: 0.6 },
});
