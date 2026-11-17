/**
 * Thời khóa biểu: weekly class sessions per subject + per-date exceptions (nghỉ, dời buổi,
 * học bù). SessionForm is the quick builder (subject → weekday → time) also used in
 * onboarding.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { resolveDeadline } from '../../../supabase/functions/_shared/vi-parse.ts';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { HeaderIconButton } from '../../components/HeaderIconButton';
import { QueryState } from '../../components/QueryState';
import { Screen } from '../../components/Screen';
import { WeekdayChips } from '../../components/SettingsRow';
import { Sheet } from '../../components/Sheet';
import { TextField } from '../../components/TextField';
import { TimeField } from '../../components/TimeField';
import { useNow } from '../../hooks/useNow';
import { vi } from '../../i18n/vi';
import { confirmDestructive } from '../../lib/confirm';
import {
  newId,
  useCreateException,
  useDeleteClassSession,
  useDeleteException,
  useSaveClassSession,
  useUpsertCollection,
} from '../../lib/api/mutations';
import { useCollections, useSettings } from '../../lib/api/queries';
import type { ClassSessionRow, Collection, ScheduleExceptionRow } from '../../lib/api/types';
import { hhmm, overlappingSessions, sortByWeekThenTime, validateSession, WEEK_ORDER } from '../../lib/settings/hours';
import { formatDayHeader } from '../../lib/time/format';
import { addDaysToKey, dateKeyOf, hhmmOf, localToInstant, weekdayOfKey } from '../../lib/time/tz';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../../theme/tokens';

const close = () => (router.canGoBack() ? router.back() : router.replace('/settings'));

export function TimetableScreen() {
  const { colors } = useTheme();
  const settings = useSettings();
  const collections = useCollections().data ?? [];
  const now = useNow(60_000);
  const tz = settings.data?.profile?.timezone ?? 'Asia/Ho_Chi_Minh';
  const del = useDeleteClassSession();
  const delEx = useDeleteException();
  const [editing, setEditing] = useState<ClassSessionRow | 'new' | null>(null);
  const [addingEx, setAddingEx] = useState(false);
  const sessions = sortByWeekThenTime(settings.data?.classSessions ?? []);
  const today = dateKeyOf(now, tz);
  const upcoming = (settings.data?.exceptions ?? []).filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const subjectOf = (id: string | null) => collections.find((c) => c.id === sessions.find((s) => s.id === id)?.collection_id)?.name ?? '—';

  return (
    <Screen title={vi.settingsPages.timetable.title} right={<HeaderIconButton icon="close" label={vi.common.close} onPress={close} />}>
      <AppText variant="secondary" tone="muted">
        {vi.settingsPages.timetable.help}
      </AppText>
      <QueryState
        isLoading={settings.isLoading}
        error={settings.error}
        hasData={Boolean(settings.data)}
        onRetry={() => void settings.refetch()}
      >
        {sessions.length === 0 ? (
          <AppText variant="body" tone="muted">
            {vi.settingsPages.timetable.empty}
          </AppText>
        ) : (
          <View style={styles.list}>
            {WEEK_ORDER.filter((d) => sessions.some((s) => s.weekday === d)).map((d) => (
              <View key={d} style={styles.group}>
                <AppText variant="meta" tone="muted">
                  {vi.weekdays[d].toUpperCase()}
                </AppText>
                {sessions
                  .filter((s) => s.weekday === d)
                  .map((s) => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      subject={collections.find((c) => c.id === s.collection_id)}
                      onPress={() => setEditing(s)}
                    />
                  ))}
              </View>
            ))}
          </View>
        )}
        <Button
          label={vi.settingsPages.timetable.addSession}
          icon={<Ionicons name="add" size={18} color="#0E1116" />}
          onPress={() => setEditing('new')}
        />

        <View style={[styles.section, { borderTopColor: colors.border }]}>
          <AppText variant="section">{vi.settingsPages.timetable.exceptions}</AppText>
          <AppText variant="secondary" tone="muted">
            {vi.settingsPages.timetable.exceptionsHelp}
          </AppText>
          {upcoming.length === 0 ? (
            <AppText variant="secondary" tone="muted">
              {vi.settingsPages.timetable.noExceptions}
            </AppText>
          ) : (
            upcoming.map((e) => (
              <View key={e.id} style={[styles.exRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.flex}>
                  <AppText variant="body" tone="heading">
                    {vi.settingsPages.timetable.exceptionLabel(
                      vi.settingsPages.timetable.types[e.type] ?? e.type,
                      subjectOf(e.class_session_id),
                      formatDayHeader(e.date),
                    )}
                  </AppText>
                  {e.new_start_at && e.new_end_at ? (
                    <AppText variant="secondary" tone="muted" numeric>
                      → {formatDayHeader(dateKeyOf(Date.parse(e.new_start_at), tz))} {hhmmOf(Date.parse(e.new_start_at), tz)}–
                      {hhmmOf(Date.parse(e.new_end_at), tz)}
                    </AppText>
                  ) : null}
                  {e.note ? (
                    <AppText variant="secondary" tone="muted">
                      {e.note}
                    </AppText>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${vi.common.delete}: ${vi.settingsPages.timetable.types[e.type]} ${formatDayHeader(e.date)}`}
                  onPress={() => void confirmDestructive(vi.common.confirmDelete).then((ok) => ok && delEx.mutate(e.id))}
                  style={styles.icon}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                </Pressable>
              </View>
            ))
          )}
          <Button
            label={vi.settingsPages.timetable.addException}
            variant="secondary"
            disabled={sessions.length === 0}
            onPress={() => setAddingEx(true)}
          />
        </View>
      </QueryState>

      <Sheet
        visible={editing != null}
        onClose={() => setEditing(null)}
        label={editing === 'new' ? vi.settingsPages.timetable.addSession : vi.settingsPages.timetable.editSession}
      >
        {editing != null && (
          <SessionForm
            key={editing === 'new' ? 'new' : editing.id}
            initial={editing === 'new' ? null : editing}
            sessions={sessions}
            collections={collections}
            onDone={() => setEditing(null)}
            onDelete={
              editing === 'new'
                ? undefined
                : () =>
                    void confirmDestructive(vi.settingsPages.timetable.deleteConfirm).then((ok) => {
                      if (!ok) return;
                      del.mutate(editing.id);
                      setEditing(null);
                    })
            }
          />
        )}
      </Sheet>
      <Sheet visible={addingEx} onClose={() => setAddingEx(false)} label={vi.settingsPages.timetable.addException}>
        {addingEx && <ExceptionForm sessions={sessions} collections={collections} tz={tz} now={now} onDone={() => setAddingEx(false)} />}
      </Sheet>
    </Screen>
  );
}

function SessionRow({ session, subject, onPress }: { session: ClassSessionRow; subject?: Collection; onPress: () => void }) {
  const { colors } = useTheme();
  const label = `${subject?.name ?? '—'}, ${hhmm(session.start_time)}–${hhmm(session.end_time)}${session.location ? `, ${session.location}` : ''}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${vi.settingsPages.timetable.editSession}: ${label}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.session,
        { backgroundColor: colors.studySoft, borderLeftColor: colors.study, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <View style={styles.flex}>
        <AppText variant="body" tone="heading">
          {subject?.name ?? '—'}
        </AppText>
        <AppText variant="secondary" tone="muted" numeric>
          {hhmm(session.start_time)}–{hhmm(session.end_time)}
          {session.location ? ` · ${session.location}` : ''}
        </AppText>
      </View>
      <Ionicons name="create-outline" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

/** Quick builder: subject → weekday → time (+ room). Creates a subject inline if needed. */
export function SessionForm({
  initial,
  sessions,
  collections,
  onDone,
  onDelete,
  submitLabel,
  defaultWeekday = 1,
}: {
  initial: ClassSessionRow | null;
  sessions: ClassSessionRow[];
  collections: Collection[];
  onDone: (saved: ClassSessionRow) => void;
  onDelete?: () => void;
  submitLabel?: string;
  defaultWeekday?: number;
}) {
  const save = useSaveClassSession();
  const upsertCollection = useUpsertCollection();
  const subjects = collections.filter((c) => c.space === 'study' && !c.archived);
  const [subjectId, setSubjectId] = useState<string | null>(initial?.collection_id ?? subjects[0]?.id ?? null);
  const [newName, setNewName] = useState('');
  const [weekday, setWeekday] = useState(initial?.weekday ?? defaultWeekday);
  const [start, setStart] = useState(hhmm(initial?.start_time) || '07:30');
  const [end, setEnd] = useState(hhmm(initial?.end_time) || '09:45');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [error, setError] = useState<string | null>(null);
  const overlap = overlappingSessions(sessions, { id: initial?.id, weekday, start_time: start, end_time: end }).length > 0;

  const submit = () => {
    const err = validateSession(start, end);
    if (err) return setError(vi.settingsPages.invalid[err] ?? null);
    let collectionId = subjectId;
    if (newName.trim()) {
      collectionId = newId();
      upsertCollection.mutate({ id: collectionId, space: 'study', kind: 'subject', name: newName.trim() });
    }
    if (!collectionId) return setError(vi.settingsPages.timetable.noSubjects);
    const row: ClassSessionRow = {
      id: initial?.id ?? newId(),
      collection_id: collectionId,
      weekday,
      start_time: start,
      end_time: end,
      location: location.trim() || null,
      valid_from: initial?.valid_from ?? null,
      valid_to: initial?.valid_to ?? null,
    };
    save.mutate(row);
    setNewName('');
    setError(null);
    onDone(row);
  };

  return (
    <View style={styles.form}>
      <AppText variant="meta" tone="muted">
        {vi.settingsPages.timetable.subject.toUpperCase()}
      </AppText>
      {subjects.length > 0 && (
        <View style={styles.chips}>
          {subjects.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              tone="study"
              selected={!newName.trim() && subjectId === c.id}
              onPress={() => {
                setSubjectId(c.id);
                setNewName('');
              }}
            />
          ))}
        </View>
      )}
      <TextField
        label={vi.settingsPages.timetable.newSubject}
        value={newName}
        onChangeText={setNewName}
        placeholder={vi.settingsPages.timetable.newSubjectPlaceholder}
        returnKeyType="done"
      />
      <AppText variant="meta" tone="muted">
        {vi.settingsPages.timetable.weekday.toUpperCase()}
      </AppText>
      <WeekdayChips value={[weekday]} onChange={(v) => setWeekday(v[0] ?? 1)} />
      <View style={styles.times}>
        <TimeField label={vi.settingsPages.workHours.start} value={start} onChange={setStart} />
        <AppText variant="body" tone="muted">
          →
        </AppText>
        <TimeField label={vi.settingsPages.workHours.end} value={end} onChange={setEnd} />
      </View>
      <TextField
        label={vi.settingsPages.timetable.location}
        value={location}
        onChangeText={setLocation}
        placeholder={vi.settingsPages.timetable.locationPlaceholder}
      />
      {overlap && (
        <AppText variant="secondary" tone="warning">
          {vi.settingsPages.timetable.overlap}
        </AppText>
      )}
      {error && (
        <AppText variant="secondary" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      )}
      <Button label={submitLabel ?? vi.common.save} onPress={submit} />
      {onDelete && <Button label={vi.common.delete} variant="ghost" onPress={onDelete} />}
    </View>
  );
}

/** Next `count` dates (from today) that fall on `weekday`. */
function nextDates(today: string, weekday: number | null, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < count && i < 120; i++) {
    const k = addDaysToKey(today, i);
    if (weekday == null || weekdayOfKey(k) === weekday) out.push(k);
  }
  return out;
}

function ExceptionForm({
  sessions,
  collections,
  tz,
  now,
  onDone,
}: {
  sessions: ClassSessionRow[];
  collections: Collection[];
  tz: string;
  now: number;
  onDone: () => void;
}) {
  const create = useCreateException();
  const today = dateKeyOf(now, tz);
  const [type, setType] = useState<ScheduleExceptionRow['type']>('cancelled');
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? null);
  const session = sessions.find((s) => s.id === sessionId) ?? null;
  const [date, setDate] = useState<string | null>(null);
  const [newDate, setNewDate] = useState<string | null>(null);
  const [start, setStart] = useState(hhmm(session?.start_time) || '07:30');
  const [end, setEnd] = useState(hhmm(session?.end_time) || '09:45');
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const t = vi.settingsPages.timetable;
  const label = (s: ClassSessionRow) =>
    `${collections.find((c) => c.id === s.collection_id)?.name ?? '—'} · ${vi.weekdaysShort[s.weekday]} ${hhmm(s.start_time)}`;
  const sessionDates = useMemo(() => nextDates(today, session?.weekday ?? null, 6), [today, session?.weekday]);
  const anyDates = useMemo(() => nextDates(today, null, 14), [today]);
  const needsNewTime = type !== 'cancelled';
  // "Học bù" happens on its own date; "Nghỉ"/"Dời" refer to a regular session date.
  const baseDate = type === 'extra' ? newDate : date;

  const typedDate = () => {
    const r = resolveDeadline(typed, now, tz);
    if (!r) return setError(vi.tasks.deadlineInvalid);
    const k = dateKeyOf(Date.parse(r.iso), tz);
    if (type === 'extra') setNewDate(k);
    else setDate(k);
    setTyped('');
    setError(null);
  };

  const submit = () => {
    if (!session) return setError(t.pickSession);
    if (!baseDate || (type === 'moved' && !newDate)) return setError(t.pickDate);
    const err = needsNewTime ? validateSession(start, end) : null;
    if (err) return setError(vi.settingsPages.invalid[err] ?? null);
    const target = type === 'cancelled' ? null : (newDate ?? baseDate);
    create.mutate({
      id: newId(),
      class_session_id: session.id,
      date: baseDate,
      type,
      new_start_at: target ? new Date(localToInstant(target, start, tz)).toISOString() : null,
      new_end_at: target ? new Date(localToInstant(target, end, tz)).toISOString() : null,
      note: note.trim() || null,
    });
    onDone();
  };

  return (
    <View style={styles.form}>
      <View style={styles.chips}>
        {(['cancelled', 'moved', 'extra'] as const).map((k) => (
          <Chip key={k} label={t.types[k] ?? k} selected={type === k} onPress={() => setType(k)} />
        ))}
      </View>
      <AppText variant="meta" tone="muted">
        {t.session.toUpperCase()}
      </AppText>
      <View style={styles.chips}>
        {sessions.map((s) => (
          <Chip
            key={s.id}
            label={label(s)}
            tone="study"
            selected={sessionId === s.id}
            onPress={() => {
              setSessionId(s.id);
              setDate(null);
              setStart(hhmm(s.start_time));
              setEnd(hhmm(s.end_time));
            }}
          />
        ))}
      </View>
      {type !== 'extra' && (
        <>
          <AppText variant="meta" tone="muted">
            {(type === 'moved' ? t.originalDate : t.date).toUpperCase()}
          </AppText>
          <DateChips dates={sessionDates} value={date} onPick={setDate} />
        </>
      )}
      {needsNewTime && (
        <>
          <AppText variant="meta" tone="muted">
            {(type === 'moved' ? t.newDate : t.date).toUpperCase()}
          </AppText>
          <DateChips dates={anyDates} value={newDate} onPick={setNewDate} />
          <View style={styles.times}>
            <TimeField label={vi.settingsPages.workHours.start} value={start} onChange={setStart} />
            <AppText variant="body" tone="muted">
              →
            </AppText>
            <TimeField label={vi.settingsPages.workHours.end} value={end} onChange={setEnd} />
          </View>
        </>
      )}
      <TextField
        label={t.moreDates}
        value={typed}
        onChangeText={setTyped}
        onSubmitEditing={typedDate}
        onBlur={() => typed.trim() && typedDate()}
        returnKeyType="done"
      />
      <TextField label={t.note} value={note} onChangeText={setNote} />
      {error && (
        <AppText variant="secondary" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      )}
      <Button label={vi.common.save} onPress={submit} />
    </View>
  );
}

function DateChips({ dates, value, onPick }: { dates: string[]; value: string | null; onPick: (k: string) => void }) {
  return (
    <View style={styles.chips}>
      {[...new Set(value && !dates.includes(value) ? [value, ...dates] : dates)].map((k) => (
        <Chip key={k} label={formatDayHeader(k)} selected={value === k} onPress={() => onPick(k)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: spacing.md },
  group: { gap: spacing.xs },
  session: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.block,
    borderLeftWidth: 3,
    padding: spacing.md,
  },
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.lg, gap: spacing.sm, marginTop: spacing.sm },
  exRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    paddingLeft: spacing.md,
    paddingVertical: spacing.xs,
  },
  icon: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  form: { gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  times: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
