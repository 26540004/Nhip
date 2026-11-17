/**
 * Settings pages for scheduling rules: office hours, study windows, daily capacity.
 * (The class timetable has its own file.) Every change is saved immediately through the
 * offline write queue and the planner picks it up on the next proposal.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { HeaderIconButton } from '../../components/HeaderIconButton';
import { QueryState } from '../../components/QueryState';
import { Screen } from '../../components/Screen';
import { TimeField } from '../../components/TimeField';
import { showToast } from '../../components/Toast';
import { vi } from '../../i18n/vi';
import { newId, useReplaceStudyWindows, useUpsertCapacity, useUpsertWorkHours } from '../../lib/api/mutations';
import { useSettings } from '../../lib/api/queries';
import type { Space, StudyWindowRow } from '../../lib/api/types';
import {
  crossesMidnight,
  fromMin,
  hhmm,
  stepCapacity,
  summarizeCapacity,
  toMin,
  validateWindow,
  WEEK_ORDER,
} from '../../lib/settings/hours';
import { formatDurationCompact } from '../../lib/time/format';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../../theme/tokens';
import { WorkHoursEditor } from './WorkHoursEditor';

const close = () => (router.canGoBack() ? router.back() : router.replace('/settings'));
const CloseButton = () => <HeaderIconButton icon="close" label={vi.common.close} onPress={close} />;

export function WorkHoursScreen() {
  const settings = useSettings();
  const save = useUpsertWorkHours();
  return (
    <Screen title={vi.settingsPages.workHours.title} right={<CloseButton />}>
      <AppText variant="secondary" tone="muted">
        {vi.settingsPages.workHours.help}
      </AppText>
      <QueryState
        isLoading={settings.isLoading}
        error={settings.error}
        hasData={Boolean(settings.data)}
        onRetry={() => void settings.refetch()}
      >
        {settings.data && <WorkHoursEditor rows={settings.data.workHours} onSave={(rows) => save.mutate(rows)} />}
      </QueryState>
    </Screen>
  );
}

// ---------------------------------------------------------------------------

export function StudyWindowsScreen() {
  const { colors } = useTheme();
  const settings = useSettings();
  const replace = useReplaceStudyWindows();
  const all = settings.data?.studyWindows ?? [];
  const ofDay = (d: number) => all.filter((w) => w.weekday === d).sort((a, b) => toMin(a.start_time) - toMin(b.start_time));
  const saveDay = (d: number, windows: StudyWindowRow[]) => replace.mutate({ weekdays: [d], windows });

  const add = (d: number) => {
    const list = ofDay(d);
    const last = list[list.length - 1];
    const start = last ? Math.min(toMin(last.end_time) + 30, 23 * 60) : d === 0 || d === 6 ? 8 * 60 : 19 * 60;
    const end = Math.min(start + 120, 23 * 60 + 59);
    saveDay(d, [...list, { id: newId(), weekday: d, start_time: fromMin(start), end_time: fromMin(end) }]);
  };
  const edit = (d: number, id: string, patch: Partial<StudyWindowRow>) => {
    const list = ofDay(d).map((w) => (w.id === id ? { ...w, ...patch } : w));
    const changed = list.find((w) => w.id === id)!;
    const err = validateWindow(changed.start_time, changed.end_time);
    if (err) {
      showToast(vi.settingsPages.invalid[err] ?? '', { tone: 'error' });
      return;
    }
    saveDay(d, list);
  };
  const copyToAll = (from: number) => {
    const src = ofDay(from);
    const others = WEEK_ORDER.filter((d) => d !== from);
    replace.mutate({
      weekdays: [...others],
      windows: others.flatMap((d) => src.map((w) => ({ id: newId(), weekday: d, start_time: w.start_time, end_time: w.end_time }))),
    });
    showToast(vi.settingsPages.studyWindows.copied);
  };

  return (
    <Screen title={vi.settingsPages.studyWindows.title} right={<CloseButton />}>
      <AppText variant="secondary" tone="muted">
        {vi.settingsPages.studyWindows.help}
      </AppText>
      <QueryState
        isLoading={settings.isLoading}
        error={settings.error}
        hasData={Boolean(settings.data)}
        onRetry={() => void settings.refetch()}
      >
        <View style={styles.list}>
          {WEEK_ORDER.map((d) => {
            const list = ofDay(d);
            return (
              <View key={d} style={[styles.day, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.head}>
                  <AppText variant="body" tone="heading" style={styles.flex}>
                    {vi.weekdays[d]}
                  </AppText>
                  {list.length > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${vi.weekdays[d]}: ${vi.settingsPages.studyWindows.copyToAll}`}
                      onPress={() => copyToAll(d)}
                      style={styles.icon}
                    >
                      <Ionicons name="copy-outline" size={18} color={colors.textMuted} />
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${vi.weekdays[d]}: ${vi.settingsPages.studyWindows.add}`}
                    onPress={() => add(d)}
                    style={styles.icon}
                  >
                    <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
                  </Pressable>
                </View>
                {list.length === 0 ? (
                  <AppText variant="secondary" tone="muted">
                    {vi.settingsPages.studyWindows.empty}
                  </AppText>
                ) : (
                  list.map((w) => (
                    <View key={w.id} style={styles.times}>
                      <TimeField
                        compact
                        label={`${vi.weekdays[d]} · ${vi.settingsPages.workHours.start}`}
                        value={hhmm(w.start_time)}
                        onChange={(v) => edit(d, w.id, { start_time: v })}
                      />
                      <AppText variant="body" tone="muted">
                        →
                      </AppText>
                      <TimeField
                        compact
                        label={`${vi.weekdays[d]} · ${vi.settingsPages.workHours.end}`}
                        value={hhmm(w.end_time)}
                        onChange={(v) => edit(d, w.id, { end_time: v })}
                      />
                      {crossesMidnight(w.start_time, w.end_time) && (
                        <AppText variant="meta" tone="warning">
                          {vi.settingsPages.studyWindows.nextDay}
                        </AppText>
                      )}
                      <View style={styles.flex} />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${vi.common.delete} ${hhmm(w.start_time)}–${hhmm(w.end_time)}`}
                        onPress={() =>
                          saveDay(
                            d,
                            list.filter((x) => x.id !== w.id),
                          )
                        }
                        style={styles.icon}
                      >
                        <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                      </Pressable>
                    </View>
                  ))
                )}
              </View>
            );
          })}
        </View>
      </QueryState>
    </Screen>
  );
}

// ---------------------------------------------------------------------------

export function CapacityScreen() {
  const { colors } = useTheme();
  const settings = useSettings();
  const upsert = useUpsertCapacity();
  const rows = settings.data?.capacity ?? [];
  const valueOf = (space: Space, d: number) => rows.find((r) => r.space === space && r.weekday === d)?.max_focus_minutes ?? 0;
  const step = (space: Space, d: number, delta: number) => {
    const next = stepCapacity(valueOf(space, d), delta);
    if (next !== valueOf(space, d)) upsert.mutate([{ space, weekday: d, max_focus_minutes: next }]);
  };

  return (
    <Screen title={vi.settingsPages.capacity.title} right={<CloseButton />}>
      <AppText variant="secondary" tone="muted">
        {vi.settingsPages.capacity.help}
      </AppText>
      <QueryState
        isLoading={settings.isLoading}
        error={settings.error}
        hasData={Boolean(settings.data)}
        onRetry={() => void settings.refetch()}
      >
        <View style={[styles.table, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.tableRow}>
            <View style={styles.dayCol} />
            {(['study', 'work'] as const).map((sp) => (
              <AppText key={sp} variant="meta" tone={sp} style={styles.colHead}>
                {vi.space[sp].toUpperCase()}
              </AppText>
            ))}
          </View>
          {WEEK_ORDER.map((d) => (
            <View key={d} style={[styles.tableRow, { borderTopColor: colors.border }, styles.rowBorder]}>
              <AppText variant="body" tone="heading" style={styles.dayCol}>
                {vi.weekdaysShort[d]}
              </AppText>
              {(['study', 'work'] as const).map((sp) => {
                const v = valueOf(sp, d);
                const label = `${vi.weekdays[d]} ${vi.space[sp]}`;
                return (
                  <View key={sp} style={styles.stepper}>
                    <StepButton
                      icon="remove"
                      label={vi.settingsPages.capacity.decrease(label)}
                      disabled={v <= 0}
                      onPress={() => step(sp, d, -30)}
                    />
                    <AppText
                      variant="body"
                      tone={v === 0 ? 'muted' : 'heading'}
                      numeric
                      style={styles.value}
                      accessibilityLabel={`${label}: ${formatDurationCompact(v)}`}
                    >
                      {v === 0 ? '—' : formatDurationCompact(v)}
                    </AppText>
                    <StepButton
                      icon="add"
                      label={vi.settingsPages.capacity.increase(label)}
                      disabled={v >= 720}
                      onPress={() => step(sp, d, 30)}
                    />
                  </View>
                );
              })}
            </View>
          ))}
        </View>
        <AppText variant="secondary" tone="muted" numeric>
          {vi.settingsPages.capacity.perWeek(
            formatDurationCompact(summarizeCapacity(rows, 'study')),
            formatDurationCompact(summarizeCapacity(rows, 'work')),
          )}
        </AppText>
      </QueryState>
    </Screen>
  );
}

function StepButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: 'add' | 'remove';
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.step, { backgroundColor: colors.surface2, opacity: disabled ? 0.35 : pressed ? 0.7 : 1 }]}
    >
      <Ionicons name={icon} size={18} color={colors.textHeading} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: spacing.sm },
  day: { borderRadius: radius.card, borderWidth: 1, padding: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  times: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  icon: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  table: { borderRadius: radius.card, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  tableRow: { flexDirection: 'row', alignItems: 'center', minHeight: touchTarget + 8, gap: spacing.sm },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth },
  dayCol: { width: 30 },
  colHead: { flex: 1, textAlign: 'center' },
  stepper: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  step: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  value: { minWidth: 38, flexShrink: 1, textAlign: 'center' },
});
