/**
 * /record — the recorder.
 *   ?note=<id>&att=<id>   from the note editor (the audio block is already in the note)
 *   ?task=<id>            attach to a task
 *   (no params)           standalone: creates a new note in the chosen subject / project
 * Big timer, live level meter, pause/resume, bookmarks, interruption recovery, stop & save.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CollectionPicker, SpacePicker } from '../../components/FieldEditors';
import { HeaderIconButton } from '../../components/HeaderIconButton';
import { Screen } from '../../components/Screen';
import { showToast } from '../../components/Toast';
import { vi } from '../../i18n/vi';
import { newId, useCreateNote } from '../../lib/api/mutations';
import { useCollections, useNote, useSettings, useTasks } from '../../lib/api/queries';
import type { Space } from '../../lib/api/types';
import { confirmDestructive } from '../../lib/confirm';
import { docToPlainText, emptyDoc, insertMedia } from '../../lib/notes/doc';
import { useMediaQueue } from '../../lib/media/queue';
import { formatDuration, recordingTitle } from '../../lib/media/recording';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing } from '../../theme/tokens';
import { getEngine } from './engine';
import { elapsedSec, useRecorderStore } from './store';

export function RecordScreen() {
  const params = useLocalSearchParams<{ note?: string; att?: string; task?: string }>();
  const session = useRecorderStore((s) => s.session);
  const lastResult = useRecorderStore((s) => s.lastResult);
  const started = useRef(false);

  // Leaving before recording: the editor removes the placeholder audio block.
  // Leaving after a result was shown: the next visit starts fresh.
  useEffect(
    () => () => {
      const st = useRecorderStore.getState();
      if (params.att && !started.current && st.session?.attachmentId !== params.att) {
        st.set({ abandoned: [...st.abandoned, params.att] });
      }
      if (!st.session && st.lastResult && !st.lastResult.seen) st.set({ lastResult: { ...st.lastResult, seen: true } });
    },
    [params.att],
  );

  const close = () => (router.canGoBack() ? router.back() : router.replace('/notes'));

  let body;
  if (session) body = <Live />;
  else if (lastResult && !lastResult.seen) body = <Saved onClose={close} />;
  else
    body = (
      <Setup
        noteId={params.note}
        attachmentId={params.att}
        taskId={params.task}
        onStarted={() => {
          started.current = true;
        }}
      />
    );

  return (
    <Screen title={vi.record.title} right={<HeaderIconButton icon="close" label={vi.common.close} onPress={close} />}>
      {body}
    </Screen>
  );
}

// ---------------------------------------------------------------------------

function Setup({
  noteId,
  attachmentId,
  taskId,
  onStarted,
}: {
  noteId?: string;
  attachmentId?: string;
  taskId?: string;
  onStarted: () => void;
}) {
  const { colors } = useTheme();
  const note = useNote(noteId).data;
  const task = useTasks().data?.find((t) => t.id === taskId);
  const collections = useCollections().data ?? [];
  const settings = useSettings().data;
  const privacy = Boolean(settings?.profile?.ai_privacy_mode);
  const tz = settings?.profile?.timezone ?? 'Asia/Ho_Chi_Minh';
  const createNote = useCreateNote();
  const busy = useRecorderStore((s) => s.busy);
  const error = useRecorderStore((s) => s.error);
  const [space, setSpace] = useState<Space>('study');
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [transcribe, setTranscribe] = useState(true);

  const start = async () => {
    const title = recordingTitle(Date.now(), tz);
    try {
      if (noteId) {
        await getEngine().start({ owner: { type: 'note', id: noteId }, attachmentId, title, transcribe: transcribe && !privacy });
      } else if (taskId) {
        await getEngine().start({ owner: { type: 'task', id: taskId }, title, transcribe: transcribe && !privacy });
      } else {
        // Standalone: a new note holding just this recording.
        const id = newId();
        const att = newId();
        const doc = insertMedia(emptyDoc(), null, 'audio', att).doc;
        createNote.mutate({ id, space, collection_id: collectionId, title, content_json: doc, plain_text: docToPlainText(doc) });
        await getEngine().start({ owner: { type: 'note', id }, attachmentId: att, title, transcribe: transcribe && !privacy });
      }
      onStarted();
    } catch {
      /* error shown from the store */
    }
  };

  return (
    <View style={styles.gap}>
      {noteId ? (
        <AppText variant="body" tone="muted">
          {vi.record.forNote(note?.title || vi.notes.untitled)}
        </AppText>
      ) : taskId ? (
        <AppText variant="body" tone="muted">
          {vi.record.forTask(task?.title ?? '…')}
        </AppText>
      ) : (
        <View style={styles.gapSm}>
          <AppText variant="meta" tone="muted">
            {vi.record.newNoteIn.toUpperCase()}
          </AppText>
          <SpacePicker
            value={space}
            onChange={(s) => {
              setSpace(s);
              setCollectionId(null);
            }}
          />
          <CollectionPicker space={space} collections={collections} value={collectionId} onChange={setCollectionId} />
        </View>
      )}

      <Card>
        <View style={styles.row}>
          <View style={styles.flex}>
            <AppText variant="body" tone="heading">
              {vi.record.autoTranscribe}
            </AppText>
            <AppText variant="secondary" tone="muted">
              {privacy ? vi.record.privacyOff : vi.record.autoTranscribeHelp}
            </AppText>
          </View>
          <Switch
            accessibilityLabel={vi.record.autoTranscribe}
            value={transcribe && !privacy}
            disabled={privacy}
            onValueChange={setTranscribe}
            trackColor={{ true: colors.primary, false: colors.surface2 }}
            thumbColor={colors.textHeading}
          />
        </View>
      </Card>

      <View style={styles.center}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={vi.record.start}
          disabled={busy}
          onPress={() => void start()}
          style={({ pressed }) => [styles.recordBtn, { backgroundColor: colors.danger, opacity: pressed || busy ? 0.7 : 1 }]}
        >
          <Ionicons name="mic" size={40} color="#0E1116" />
        </Pressable>
        <AppText variant="body" tone="heading">
          {vi.record.start}
        </AppText>
        {error && (
          <AppText variant="secondary" tone="danger" style={styles.textCenter} accessibilityLiveRegion="polite">
            {vi.errors[error] ?? vi.errors.start_failed}
          </AppText>
        )}
        <AppText variant="secondary" tone="muted" style={styles.textCenter}>
          {Platform.OS === 'web' ? vi.record.webHint : vi.record.lockHint}
        </AppText>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

function Live() {
  const { colors } = useTheme();
  const session = useRecorderStore((s) => s.session)!;
  const elapsed = useRecorderStore(elapsedSec);
  const level = useRecorderStore((s) => s.level);
  const busy = useRecorderStore((s) => s.busy);
  const jobs = useMediaQueue((s) => s.jobs);
  const pendingUploads = jobs.filter((j) => j.segment?.attachmentId === session.attachmentId).length;
  const uploaded = session.segments.length - pendingUploads;
  const status = session.status;
  const meter = useAnimatedStyle(() => ({ width: withTiming(`${Math.round(level * 100)}%`, { duration: 120 }) }), [level]);

  const stop = async () => {
    await getEngine().stop();
  };
  const discard = async () => {
    if (!(await confirmDestructive(vi.record.discardConfirm, vi.record.discard))) return;
    await getEngine().discard();
    router.back();
  };

  const tone = status === 'recording' ? colors.danger : colors.warning;
  return (
    <View style={styles.gap}>
      <View style={styles.center}>
        <View style={styles.statusRow} accessibilityLiveRegion="polite">
          <View style={[styles.dot, { backgroundColor: tone }]} />
          <AppText variant="secondary" tone={status === 'recording' ? 'danger' : 'warning'}>
            {vi.record.status[status]}
          </AppText>
        </View>
        <AppText variant="display" tone="heading" numeric accessibilityRole="timer" accessibilityLabel={formatDuration(elapsed)}>
          {formatDuration(elapsed)}
        </AppText>
        {Platform.OS !== 'web' && (
          // Browsers don't report input levels through expo-audio; the meter is iPhone-only.
          <View style={[styles.meterTrack, { backgroundColor: colors.surface2 }]} accessibilityLabel={vi.record.level} accessible>
            <Animated.View
              style={[styles.meterFill, { backgroundColor: status === 'recording' ? colors.success : colors.textMuted }, meter]}
            />
          </View>
        )}
        <AppText variant="meta" tone="muted" numeric>
          {vi.record.segments(session.segments.length + 1, Math.max(0, uploaded))}
        </AppText>
      </View>

      {status === 'interrupted' && (
        <Card>
          <AppText variant="body" tone="warning">
            {vi.record.interruptedHelp}
          </AppText>
        </Card>
      )}

      <View style={styles.controls}>
        <RoundButton
          icon="bookmark-outline"
          label={vi.record.bookmark}
          disabled={status !== 'recording'}
          onPress={() => {
            const at = getEngine().bookmark();
            showToast(vi.record.bookmarked(formatDuration(at)), { durationMs: 1500 });
          }}
        />
        <RoundButton
          big
          icon={status === 'recording' ? 'pause' : 'mic'}
          label={status === 'recording' ? vi.record.pause : vi.record.resume}
          disabled={busy}
          onPress={() => (status === 'recording' ? getEngine().pause() : void getEngine().resume())}
        />
        <RoundButton icon="stop" label={vi.record.stop} tone="danger" disabled={busy} onPress={() => void stop()} />
      </View>

      {session.bookmarks.length > 0 && (
        <View style={styles.gapSm}>
          <AppText variant="meta" tone="muted">
            {vi.record.bookmarks.toUpperCase()}
          </AppText>
          <View style={styles.wrap}>
            {session.bookmarks.map((b, i) => (
              <View key={i} style={[styles.bookmark, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name="bookmark" size={12} color={colors.primary} />
                <AppText variant="meta" tone="primary" numeric>
                  {formatDuration(b.at_sec)}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      )}

      <AppText variant="secondary" tone="muted" style={styles.textCenter}>
        {Platform.OS === 'web' ? vi.record.webHint : vi.record.lockHint}
      </AppText>
      <Button label={vi.record.discard} variant="ghost" onPress={() => void discard()} />
    </View>
  );
}

function RoundButton({
  icon,
  label,
  onPress,
  big,
  tone,
  disabled,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  big?: boolean;
  tone?: 'danger';
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const size = big ? 84 : 64;
  const bg = big ? colors.textHeading : tone === 'danger' ? colors.danger : colors.surface2;
  const fg = big || tone === 'danger' ? '#0E1116' : colors.textHeading;
  return (
    <View style={styles.roundWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
          styles.roundBtn,
        ]}
      >
        <Ionicons name={icon} size={big ? 36 : 26} color={fg} />
      </Pressable>
      <AppText variant="meta" tone="muted">
        {label}
      </AppText>
    </View>
  );
}

// ---------------------------------------------------------------------------

function Saved({ onClose }: { onClose: () => void }) {
  const r = useRecorderStore((s) => s.lastResult)!;
  return (
    <View style={[styles.gap, styles.center]}>
      <Ionicons name={r.saved ? 'checkmark-circle' : 'alert-circle'} size={56} color={r.saved ? '#3DD68C' : '#F5C451'} />
      <AppText variant="section" style={styles.textCenter}>
        {r.recovered && r.saved
          ? vi.record.recovered(r.segmentCount)
          : r.saved
            ? vi.record.saved(formatDuration(r.durationSec))
            : vi.record.nothingSaved}
      </AppText>
      {r.saved && r.owner.type === 'note' && (
        <Button label={vi.record.openNote} onPress={() => router.replace({ pathname: '/note/[id]', params: { id: r.owner.id } })} />
      )}
      <Button label={vi.common.done} variant="secondary" onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: spacing.lg },
  gapSm: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  center: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  textCenter: { textAlign: 'center' },
  recordBtn: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  meterTrack: { width: '80%', maxWidth: 360, height: 8, borderRadius: 4, overflow: 'hidden' },
  meterFill: { height: 8, borderRadius: 4 },
  controls: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'flex-start' },
  roundWrap: { alignItems: 'center', gap: spacing.xs, minWidth: 88 },
  roundBtn: { alignItems: 'center', justifyContent: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  bookmark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.chip,
  },
});
