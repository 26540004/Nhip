/** Settings → Nhắc nhở: brief/review times, start offset, deadline offsets, quiet hours. */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';
import { AppText } from '../../src/components/AppText';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Chip } from '../../src/components/Chip';
import { HeaderIconButton } from '../../src/components/HeaderIconButton';
import { QueryState } from '../../src/components/QueryState';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { vi } from '../../src/i18n/vi';
import { useUpdateReminders } from '../../src/lib/api/mutations';
import { useSettings } from '../../src/lib/api/queries';
import { getPermission, type PermissionState, requestPermission } from '../../src/lib/notifications/localAdapter';
import { useTheme } from '../../src/theme/ThemeProvider';
import { spacing, touchTarget } from '../../src/theme/tokens';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function TimeInput({ label, value, onCommit }: { label: string; value: string | null; onCommit: (v: string) => void }) {
  const [text, setText] = useState((value ?? '').slice(0, 5));
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={styles.time}>
      <TextField
        label={label}
        value={text}
        onChangeText={setText}
        keyboardType="numbers-and-punctuation"
        maxLength={5}
        error={error}
        onBlur={() => {
          if (!HHMM.test(text)) return setError(vi.reminders.invalidTime);
          setError(null);
          if (text !== (value ?? '').slice(0, 5)) onCommit(`${text}:00`);
        }}
      />
    </View>
  );
}

export default function RemindersSettings() {
  const { colors } = useTheme();
  const settings = useSettings();
  const r = settings.data?.reminders;
  const update = useUpdateReminders();
  const [perm, setPerm] = useState<PermissionState>('unsupported');
  useEffect(() => {
    void getPermission().then(setPerm);
  }, []);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/settings'));

  return (
    <Screen title={vi.reminders.title} right={<HeaderIconButton icon="close" label={vi.common.close} onPress={close} />}>
      {Platform.OS === 'web' ? (
        <AppText variant="secondary" tone="muted">
          {vi.reminders.webNote}
        </AppText>
      ) : perm === 'undetermined' ? (
        <Card>
          <AppText variant="secondary">{vi.reminders.enableBody}</AppText>
          <Button label={vi.reminders.enable} onPress={() => void requestPermission().then(setPerm)} />
        </Card>
      ) : perm === 'denied' ? (
        <AppText variant="secondary" tone="warning">
          {vi.reminders.denied}
        </AppText>
      ) : null}

      <QueryState isLoading={settings.isLoading} error={settings.error} hasData={Boolean(r)} onRetry={() => void settings.refetch()}>
        {r && (
          <>
            <Card>
              {(
                [
                  ['morning_brief_enabled', 'morning_brief_time', vi.reminders.morning],
                  ['evening_review_enabled', 'evening_review_time', vi.reminders.evening],
                ] as const
              ).map(([flag, time, label]) => (
                <View key={flag} style={styles.block}>
                  <View style={styles.row}>
                    <AppText variant="body" tone="heading" style={styles.flex}>
                      {label}
                    </AppText>
                    <Switch
                      accessibilityLabel={label}
                      value={r[flag]}
                      onValueChange={(v) => update.mutate({ [flag]: v })}
                      trackColor={{ true: colors.primary, false: colors.surface2 }}
                      thumbColor={colors.textHeading}
                      {...({ activeThumbColor: colors.textHeading } as object)}
                    />
                  </View>
                  {r[flag] && (
                    <TimeInput key={r[time]} label={vi.reminders.time} value={r[time]} onCommit={(v) => update.mutate({ [time]: v })} />
                  )}
                </View>
              ))}
            </Card>

            <Card>
              <AppText variant="body" tone="heading">
                {vi.reminders.startOffset}
              </AppText>
              <View style={styles.wrap}>
                {vi.reminders.startOptions.map((m) => (
                  <Chip
                    key={m}
                    label={vi.reminders.minutesShort(m)}
                    selected={r.start_offset_minutes === m}
                    onPress={() => update.mutate({ start_offset_minutes: m })}
                  />
                ))}
              </View>
            </Card>

            <Card>
              <AppText variant="body" tone="heading">
                {vi.reminders.deadlineOffsets}
              </AppText>
              <View style={styles.wrap}>
                {vi.reminders.offsetOptions.map((o) => {
                  const on = r.deadline_offsets_minutes.includes(o.minutes);
                  return (
                    <Chip
                      key={o.minutes}
                      label={o.label}
                      selected={on}
                      onPress={() =>
                        update.mutate({
                          deadline_offsets_minutes: on
                            ? r.deadline_offsets_minutes.filter((x) => x !== o.minutes)
                            : [...r.deadline_offsets_minutes, o.minutes].sort((a, b) => b - a),
                        })
                      }
                    />
                  );
                })}
              </View>
            </Card>

            <Card>
              <AppText variant="body" tone="heading">
                {vi.reminders.quiet}
              </AppText>
              <View style={styles.row}>
                <TimeInput
                  key={`qs-${r.quiet_start}`}
                  label={vi.reminders.quietFrom}
                  value={r.quiet_start}
                  onCommit={(v) => update.mutate({ quiet_start: v })}
                />
                <TimeInput
                  key={`qe-${r.quiet_end}`}
                  label={vi.reminders.quietTo}
                  value={r.quiet_end}
                  onCommit={(v) => update.mutate({ quiet_end: v })}
                />
              </View>
            </Card>
          </>
        )}
      </QueryState>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget },
  block: { gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  time: { flex: 1, maxWidth: 160 },
});
