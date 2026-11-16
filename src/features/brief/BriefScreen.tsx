/**
 * Morning brief (/brief, opened from the 07:00 notification): today's load per space,
 * top 3 priorities with reasons, deadlines within 7 days, warnings. All computed by code
 * (brief-core), identical to what the notification said.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { buildBrief } from '../../../supabase/functions/_shared/brief-core.ts';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { CapacityBar } from '../../components/CapacityBar';
import { Card } from '../../components/Card';
import { formatDeadlineShort } from '../../components/FieldEditors';
import { HeaderIconButton } from '../../components/HeaderIconButton';
import { QueryState } from '../../components/QueryState';
import { Screen } from '../../components/Screen';
import { vi } from '../../i18n/vi';
import { dayLoad } from '../../lib/planning/capacity';
import { formatDayHeader, formatDurationLong } from '../../lib/time/format';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';
import { useStartPlan } from '../plan/useStartPlan';
import { useBriefInput } from './useBriefData';

export function BriefScreen() {
  const { colors } = useTheme();
  const { input, ready, refetch } = useBriefInput();
  const brief = buildBrief(input);
  const plan = useStartPlan();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <Screen title={vi.brief.title} right={<HeaderIconButton icon="close" label={vi.common.close} onPress={close} />}>
      <AppText variant="secondary" tone="muted">
        {formatDayHeader(brief.date)}
      </AppText>
      <QueryState isLoading={!ready} error={null} hasData={ready} onRetry={refetch}>
        <Card ai>
          <AppText variant="body" tone="heading">
            {brief.summary}
          </AppText>
        </Card>

        <Card>
          <AppText variant="meta" tone="muted">
            {vi.brief.load.toUpperCase()}
          </AppText>
          {brief.loads.map((l) => (
            <CapacityBar
              key={l.space}
              load={dayLoad(brief.date, l.space, l.used, input.capacity)}
              onRebalance={() => void plan.start({ rebalance_date: brief.date })}
            />
          ))}
        </Card>

        <View style={styles.section}>
          <AppText variant="section">{vi.brief.top}</AppText>
          {brief.top.length === 0 && (
            <AppText variant="secondary" tone="muted">
              {vi.brief.noTasks}
            </AppText>
          )}
          {brief.top.map((t, i) => (
            <Card key={t.id}>
              <View style={styles.row}>
                <AppText variant="section" tone="primary" numeric>
                  {String(i + 1)}
                </AppText>
                <View style={styles.flex}>
                  <AppText variant="listTitle" onPress={() => router.push({ pathname: '/task/[id]', params: { id: t.id } })}>
                    {t.title}
                  </AppText>
                  <AppText variant="secondary" tone="muted">
                    {t.reason}
                  </AppText>
                </View>
              </View>
            </Card>
          ))}
        </View>

        {brief.dueSoon.length > 0 && (
          <View style={styles.section}>
            <AppText variant="section">{vi.brief.dueSoon}</AppText>
            {brief.dueSoon.map((d) => {
              const short = d.estimate != null && d.scheduledMinutes < d.estimate;
              return (
                <View key={d.id} style={[styles.due, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <Ionicons
                    name={short ? 'alert-circle' : 'checkmark-circle-outline'}
                    size={18}
                    color={short ? colors.warning : colors.success}
                  />
                  <View style={styles.flex}>
                    <AppText variant="body" tone="heading" onPress={() => router.push({ pathname: '/task/[id]', params: { id: d.id } })}>
                      {d.title}
                    </AppText>
                    <AppText variant="meta" tone="muted" numeric>
                      {`${formatDeadlineShort(d.deadline_at)} · ${
                        d.estimate != null
                          ? vi.brief.scheduledOf(formatDurationLong(d.scheduledMinutes), formatDurationLong(d.estimate))
                          : d.scheduledMinutes
                            ? formatDurationLong(d.scheduledMinutes)
                            : vi.brief.notScheduled
                      }`}
                    </AppText>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <Button label={vi.aiPlan.button} variant="ai" loading={plan.busy} onPress={() => void plan.start({ range: 'today' })} />
        <Button label={vi.brief.openToday} variant="secondary" onPress={() => router.replace('/')} />
      </QueryState>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  due: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: 12, padding: spacing.md },
});
