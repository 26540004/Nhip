/**
 * Inline field editors shared by Quick Add previews and the task form:
 * space, collection, deadline (quick picks + free Vietnamese text), estimate, priority.
 * Deadline text goes through the same deterministic resolver as the server.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { resolveDeadline } from '../../supabase/functions/_shared/vi-parse.ts';
import { vi } from '../i18n/vi';
import type { Collection, Priority, Space } from '../lib/api/types';
import { formatDurationLong } from '../lib/time/format';
import { APP_TZ, addDaysToKey, dateKeyOf, localToInstant, toLocalIso, weekdayOfKey } from '../lib/time/tz';
import { spacing } from '../theme/tokens';
import { Chip } from './Chip';
import { TextField } from './TextField';

export function formatDeadlineShort(iso: string | null, tz: string = APP_TZ): string {
  if (!iso) return vi.quickAdd.noDeadline;
  const t = Date.parse(iso);
  const key = dateKeyOf(t, tz);
  const [, m, d] = key.split('-');
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
  const day = `${vi.weekdaysShort[weekdayOfKey(key)]} ${Number(d)}/${Number(m)}`;
  return time === '23:59' ? day : `${day} ${time}`;
}

export function SpacePicker({ value, onChange, uncertain }: { value: Space; onChange: (s: Space) => void; uncertain?: boolean }) {
  return (
    <View style={styles.row}>
      {(['study', 'work'] as const).map((s) => (
        <Chip
          key={s}
          label={vi.spaceFilter[s]}
          tone={s}
          selected={value === s}
          highlight={uncertain && value === s}
          onPress={() => onChange(s)}
          accessibilityLabel={`${vi.tasks.fields.space}: ${vi.space[s]}`}
        />
      ))}
    </View>
  );
}

export function CollectionPicker({
  space,
  collections,
  value,
  onChange,
}: {
  space: Space;
  collections: readonly Collection[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const options = collections.filter((c) => c.space === space && !c.archived);
  return (
    <View style={styles.wrapRow}>
      <Chip label={vi.quickAdd.noCollection} selected={value == null} onPress={() => onChange(null)} />
      {options.map((c) => (
        <Chip key={c.id} label={c.name} tone={space} selected={value === c.id} onPress={() => onChange(c.id)} />
      ))}
    </View>
  );
}

export function DeadlineEditor({
  value,
  onChange,
  now,
  tz = APP_TZ,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
  now: number;
  tz?: string;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const today = dateKeyOf(now, tz);
  const endOf = (key: string) => toLocalIso(localToInstant(key, '23:59', tz), tz);
  const toFriday = (5 - weekdayOfKey(today) + 7) % 7;
  const toNextMonday = (8 - weekdayOfKey(today)) % 7 || 7;
  const quick: [string, string | null][] = [
    [vi.tasks.quickDeadline.today, endOf(today)],
    [vi.tasks.quickDeadline.tomorrow, endOf(addDaysToKey(today, 1))],
    [vi.tasks.quickDeadline.friday, endOf(addDaysToKey(today, toFriday))],
    [vi.tasks.quickDeadline.nextWeek, endOf(addDaysToKey(today, toNextMonday + 4))],
    [vi.tasks.quickDeadline.clear, null],
  ];
  const submit = () => {
    const r = resolveDeadline(text, now, tz);
    if (!r) {
      setError(vi.tasks.deadlineInvalid);
      return;
    }
    setError(null);
    setText('');
    onChange(r.iso);
  };
  return (
    <View style={styles.col}>
      <View style={styles.wrapRow}>
        {quick.map(([label, iso]) => (
          <Chip key={label} label={label} selected={iso != null && value === iso} onPress={() => onChange(iso)} />
        ))}
      </View>
      <TextField
        value={text}
        onChangeText={setText}
        placeholder={vi.tasks.deadlineInputHint}
        returnKeyType="done"
        onSubmitEditing={submit}
        onBlur={() => text.trim() && submit()}
        error={error}
        accessibilityLabel={vi.tasks.fields.deadline}
      />
    </View>
  );
}

export function EstimatePicker({ value, onChange }: { value: number | null; onChange: (m: number | null) => void }) {
  const options = vi.tasks.estimateOptions;
  const list = value != null && !options.includes(value) ? [...options, value].sort((a, b) => a - b) : options;
  return (
    <View style={styles.wrapRow}>
      <Chip label={vi.quickAdd.noEstimate} selected={value == null} onPress={() => onChange(null)} />
      {list.map((m) => (
        <Chip key={m} label={formatDurationLong(m)} selected={value === m} onPress={() => onChange(m)} />
      ))}
    </View>
  );
}

export function PriorityPicker({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  return (
    <View style={styles.row}>
      {([1, 2, 3] as const).map((p) => (
        <Chip
          key={p}
          label={vi.priority[p]}
          icon={p === 1 ? 'arrow-up-circle' : p === 2 ? 'remove-circle-outline' : 'arrow-down-circle-outline'}
          tone={p === 1 ? 'danger' : 'neutral'}
          selected={value === p}
          onPress={() => onChange(p)}
          accessibilityLabel={`${vi.tasks.fields.priority} ${vi.priority[p]}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  col: { gap: spacing.sm },
});
