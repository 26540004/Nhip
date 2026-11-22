/**
 * A recording inside a note or task: player (seek bar with bookmark markers, ±15 s, speed)
 * and the transcription panel (progress per segment, retry of failed segments, summary with
 * "Tạo việc từ đây", and a tappable timestamped transcript).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { resolveDeadline } from '../../../supabase/functions/_shared/vi-parse.ts';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { showToast } from '../../components/Toast';
import { vi } from '../../i18n/vi';
import { useQueryClient } from '@tanstack/react-query';
import { audioState } from '../../../supabase/functions/_shared/audio-retention.ts';
import { askConfirm } from '../../components/ConfirmHost';
import { deleteAudio, transcribe } from '../../lib/api/functions';
import { newId, useCreateTasks, useUpdateAttachment } from '../../lib/api/mutations';
import { qk, useAttachments, useSegments, useSettings } from '../../lib/api/queries';
import { ApiError, isDemo } from '../../lib/api/supabase';
import type { Attachment, AudioMeta, AudioSegment, Space, TranscriptLine } from '../../lib/api/types';
import { useMediaQueue } from '../../lib/media/queue';
import { formatDuration } from '../../lib/media/recording';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../../theme/tokens';
import { elapsedSec, useRecorderStore } from '../record/store';
import { useSegmentPlayer } from './useSegmentPlayer';

export interface TaskContext {
  space: Space;
  collection_id: string | null;
  source_note_id: string | null;
}

export function AudioCard({
  attachment,
  taskContext,
  onRemove,
}: {
  attachment: Attachment;
  taskContext: TaskContext;
  onRemove?: () => void;
}) {
  const { colors } = useTheme();
  const live = useRecorderStore((s) => (s.session?.attachmentId === attachment.id ? s.session.status : null));
  const liveElapsed = useRecorderStore((s) => (s.session?.attachmentId === attachment.id ? elapsedSec(s) : 0));
  const processing = attachment.transcript_status === 'processing';
  useAttachments(attachment.owner_id, { poll: processing });
  const segments = useSegments(attachment.id, processing || Boolean(live)).data ?? [];

  if (live) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={vi.record.openRecorder}
        onPress={() => router.push('/record')}
        style={[styles.card, styles.row, { backgroundColor: colors.surface, borderColor: colors.danger }]}
      >
        <View style={[styles.dot, { backgroundColor: colors.danger }]} />
        <AppText variant="body" tone="heading" style={styles.flex}>
          {vi.record.status[live]}
        </AppText>
        <AppText variant="body" tone="heading" numeric>
          {formatDuration(liveElapsed)}
        </AppText>
      </Pressable>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.row}>
        <Ionicons name="mic" size={18} color={colors.primary} />
        <AppText variant="body" tone="heading" style={styles.flex} numberOfLines={1}>
          {attachment.title || vi.media.recordings}
        </AppText>
        {onRemove && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={vi.notes.removeBlock}
            onPress={onRemove}
            style={styles.iconBtn}
            hitSlop={8}
          >
            <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
          </Pressable>
        )}
      </View>
      {attachment.audio_deleted_at ? (
        <>
          <View style={styles.row}>
            <Ionicons name="document-text-outline" size={16} color={colors.textMuted} />
            <AppText variant="meta" tone="muted" style={styles.flex}>
              {vi.audioRetention.deleted}
            </AppText>
          </View>
          <TranscriptPanel attachment={attachment} segments={segments} seek={() => undefined} position={-1} taskContext={taskContext} />
        </>
      ) : (
        <Player attachment={attachment} segments={segments}>
          {(seek, position) => (
            <>
              <RetentionRow attachment={attachment} />
              <TranscriptPanel attachment={attachment} segments={segments} seek={seek} position={position} taskContext={taskContext} />
            </>
          )}
        </Player>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function Player({
  attachment,
  segments,
  children,
}: {
  attachment: Attachment;
  segments: AudioSegment[];
  children: (seek: (t: number) => void, position: number) => React.ReactNode;
}) {
  const { colors } = useTheme();
  const p = useSegmentPlayer(segments, attachment.duration_sec ?? 0);
  const [width, setWidth] = useState(0);
  const bookmarks = attachment.bookmarks_json ?? [];
  const pct = p.duration > 0 ? Math.min(1, p.position / p.duration) : 0;
  const noFiles = segments.length === 0;

  return (
    <View style={styles.gapSm}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={p.playing ? vi.player.pause : vi.player.play}
          onPress={p.toggle}
          disabled={noFiles}
          style={[styles.play, { backgroundColor: colors.primary, opacity: noFiles ? 0.4 : 1 }]}
        >
          <Ionicons name={p.playing ? 'pause' : 'play'} size={22} color="#0E1116" />
        </Pressable>
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel={vi.player.seek}
          accessibilityValue={{ min: 0, max: Math.round(p.duration), now: Math.round(p.position), text: formatDuration(p.position) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => p.seek(p.position + (e.nativeEvent.actionName === 'increment' ? 15 : -15))}
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
          onPress={(e) => width > 0 && p.seek((e.nativeEvent.locationX / width) * p.duration)}
          style={styles.track}
        >
          <View style={[styles.rail, { backgroundColor: colors.surface2 }]}>
            <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: colors.primary }]} />
          </View>
          {p.duration > 0 &&
            bookmarks.map((b, i) => (
              <View
                key={i}
                pointerEvents="none"
                style={[styles.marker, { left: `${Math.min(100, (b.at_sec / p.duration) * 100)}%`, backgroundColor: colors.warning }]}
              />
            ))}
          <View pointerEvents="none" style={[styles.knob, { left: `${pct * 100}%`, backgroundColor: colors.textHeading }]} />
        </Pressable>
      </View>
      <View style={styles.row}>
        <AppText variant="meta" tone="muted" numeric style={styles.flex}>
          {formatDuration(p.position)} / {formatDuration(p.duration)}
        </AppText>
        <SmallButton label={vi.player.back15} icon="play-back" onPress={() => p.seek(p.position - 15)} disabled={noFiles} />
        <SmallButton label={vi.player.fwd15} icon="play-forward" onPress={() => p.seek(p.position + 15)} disabled={noFiles} />
        <Pressable accessibilityRole="button" accessibilityLabel={vi.player.speed(p.rate)} onPress={p.cycleRate} style={styles.iconBtn}>
          <AppText variant="meta" tone="heading" numeric>
            {p.rate}×
          </AppText>
        </Pressable>
      </View>
      {bookmarks.length > 0 && (
        <View style={styles.wrap}>
          {bookmarks.map((b, i) => (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={vi.player.jumpTo(formatDuration(b.at_sec))}
              onPress={() => p.seek(b.at_sec, true)}
              style={[styles.chip, { backgroundColor: colors.primarySoft }]}
            >
              <Ionicons name="bookmark" size={12} color={colors.warning} />
              <AppText variant="meta" tone="primary" numeric>
                {formatDuration(b.at_sec)}
              </AppText>
            </Pressable>
          ))}
        </View>
      )}
      {p.unavailable && (
        <AppText variant="meta" tone="muted">
          {isDemo ? vi.player.demoNoAudio : vi.player.unavailable}
        </AppText>
      )}
      {children((t) => p.seek(t, true), p.position)}
    </View>
  );
}

/** Countdown to the automatic audio deletion, with "Xoá âm thanh ngay". */
function RetentionRow({ attachment }: { attachment: Attachment }) {
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const state = audioState(attachment, now);
  useEffect(() => {
    if (state.kind !== 'expiring') return;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [state.kind]);
  if (state.kind !== 'expiring') return null;

  const remove = async () => {
    if (!(await askConfirm(vi.audioRetention.confirm, vi.audioRetention.deleteNow))) return;
    setBusy(true);
    try {
      const { audio_deleted_at } = await deleteAudio(attachment.id);
      qc.setQueryData<Attachment[]>(qk.attachments(attachment.owner_id), (old) =>
        old?.map((a) => (a.id === attachment.id ? { ...a, audio_deleted_at, audio_expires_at: null } : a)),
      );
      void qc.invalidateQueries({ queryKey: ['storage-usage'] });
      showToast(vi.audioRetention.done);
    } catch (e) {
      showToast(errorText(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.retention}>
      <Ionicons name="time-outline" size={16} color={state.days < 1 ? colors.warning : colors.textMuted} />
      <AppText variant="meta" tone={state.days < 1 ? 'warning' : 'muted'} style={styles.retentionText} accessibilityLiveRegion="polite">
        {vi.audioRetention.countdown(state.label)}
      </AppText>
      <Button label={vi.audioRetention.deleteNow} variant="ghost" icon="trash-outline" loading={busy} onPress={() => void remove()} />
    </View>
  );
}

function SmallButton({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={[styles.iconBtn, disabled && styles.dim]}
    >
      <Ionicons name={icon} size={18} color={colors.textHeading} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Transcript & summary
// ---------------------------------------------------------------------------

const PAGE = 150;

export function errorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'internal';
  return vi.errors[code] ?? vi.errors.internal ?? '';
}

function TranscriptPanel({
  attachment,
  segments,
  seek,
  position,
  taskContext,
}: {
  attachment: Attachment;
  segments: AudioSegment[];
  seek: (t: number) => void;
  position: number;
  taskContext: TaskContext;
}) {
  const { colors } = useTheme();
  const settings = useSettings().data;
  const privacy = Boolean(settings?.profile?.ai_privacy_mode);
  const tz = settings?.profile?.timezone ?? 'Asia/Ho_Chi_Minh';
  const update = useUpdateAttachment(attachment.owner_id);
  const createTasks = useCreateTasks();
  const uploads = useMediaQueue((s) => s.jobs.filter((j) => j.segment?.attachmentId === attachment.id).length);
  const kickQueued = useMediaQueue((s) => Boolean(s.kicks[attachment.id]));
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [sending, setSending] = useState(false);
  const meta = attachment.meta_json as AudioMeta;
  const status = attachment.transcript_status ?? 'none';

  // While processing, nudge the queue now and then (the server cron also keeps it moving).
  useEffect(() => {
    if (status !== 'processing') return;
    const t = setInterval(() => useMediaQueue.getState().addKick(attachment.id, 'process'), 60_000);
    return () => clearInterval(t);
  }, [status, attachment.id]);

  const lines: TranscriptLine[] = useMemo(
    () => [...segments].sort((a, b) => a.seq - b.seq).flatMap((s) => (s.transcript_status === 'done' ? (s.transcript_json ?? []) : [])),
    [segments],
  );
  const total = Math.max(meta.segment_count ?? 0, segments.length);
  const done = segments.filter((s) => s.transcript_status === 'done').length;
  const failed = segments.filter((s) => s.transcript_status === 'failed');
  const activeIdx = lines.findIndex((l, i) => l.t <= position && (lines[i + 1]?.t ?? Infinity) > position);

  const call = async (action: 'start' | 'retry' | 'summarize', segmentId?: string) => {
    setSending(true);
    try {
      await transcribe(attachment.id, action, segmentId);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'offline') {
        useMediaQueue.getState().addKick(attachment.id, 'start');
        showToast(vi.transcript.offlineQueued);
      } else showToast(errorText(e), { tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  const createHomework = (index: number) => {
    const hw = attachment.summary_json?.homework[index];
    if (!hw) return;
    const id = newId();
    const deadline = hw.deadline_hint ? (resolveDeadline(hw.deadline_hint, Date.now(), tz)?.iso ?? null) : null;
    createTasks.mutate([{ id, title: hw.title, deadline_at: deadline, source: 'note', ...taskContext }]);
    update.mutate({ id: attachment.id, patch: { meta_json: { ...meta, created_tasks: { ...(meta.created_tasks ?? {}), [index]: id } } } });
    return id;
  };

  if (privacy && status === 'none') {
    return (
      <AppText variant="secondary" tone="muted">
        {vi.transcript.privacy}
      </AppText>
    );
  }

  if (status === 'none') {
    return (
      <View style={styles.gapSm}>
        <Button label={vi.transcript.start} variant="ai" loading={sending || kickQueued} onPress={() => void call('start')} />
        <AppText variant="meta" tone="muted">
          {kickQueued ? vi.transcript.offlineQueued : vi.transcript.startHelp}
        </AppText>
      </View>
    );
  }

  const summary = attachment.summary_json;
  return (
    <View style={styles.gapMd}>
      {status === 'processing' && (
        <View style={styles.gapSm} accessibilityLiveRegion="polite">
          <View style={styles.row}>
            <Ionicons name="sparkles" size={16} color={colors.primary} />
            <AppText variant="secondary" tone="heading" style={styles.flex}>
              {meta.recording === 'recording'
                ? vi.transcript.waitingRecording
                : done < total
                  ? vi.transcript.processing(Math.min(done + 1, total), total)
                  : vi.transcript.queued}
            </AppText>
          </View>
          <View style={[styles.rail, { backgroundColor: colors.surface2 }]}>
            <View style={[styles.fill, { width: `${total ? (done / total) * 100 : 0}%`, backgroundColor: colors.primary }]} />
          </View>
          {uploads > 0 && (
            <AppText variant="meta" tone="muted">
              {vi.transcript.uploading(uploads)}
            </AppText>
          )}
        </View>
      )}

      {failed.length > 0 && status !== 'processing' && (
        <View style={styles.gapSm}>
          <AppText variant="secondary" tone="warning">
            {vi.transcript.partial}
          </AppText>
          {failed.map((s) => (
            <View key={s.id} style={styles.row}>
              <AppText variant="secondary" tone="muted" style={styles.flex}>
                {vi.transcript.failedSegment(
                  s.seq + 1,
                  `${formatDuration(Number(s.start_offset_sec))}–${formatDuration(Number(s.start_offset_sec) + Number(s.duration_sec))}`,
                )}
              </AppText>
              <Button label={vi.transcript.retry} variant="secondary" loading={sending} onPress={() => void call('retry', s.id)} />
            </View>
          ))}
          {failed.length > 1 && <Button label={vi.transcript.retryAll} variant="ghost" onPress={() => void call('retry')} />}
        </View>
      )}

      {status === 'done' && summary && <SummaryView summary={summary} meta={meta} onCreate={createHomework} />}
      {status === 'done' && !summary && (
        <View style={styles.row}>
          <AppText variant="secondary" tone="muted" style={styles.flex}>
            {lines.length ? vi.transcript.noSummary : vi.transcript.empty}
          </AppText>
          {lines.length > 0 && (
            <Button label={vi.transcript.resummarize} variant="secondary" loading={sending} onPress={() => void call('summarize')} />
          )}
        </View>
      )}

      {lines.length > 0 && (
        <View style={styles.gapSm}>
          <Pressable accessibilityRole="button" onPress={() => setOpen((v) => !v)} style={styles.row}>
            <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.textMuted} />
            <AppText variant="secondary" tone="primary">
              {open ? vi.transcript.hideTranscript : vi.transcript.showTranscript(lines.length)}
            </AppText>
          </Pressable>
          {open && (
            <View style={styles.gapXs}>
              {lines.slice(0, shown).map((l, i) => (
                <Pressable
                  key={`${l.t}-${i}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${vi.player.jumpTo(formatDuration(l.t))}. ${l.text}`}
                  onPress={() => seek(l.t)}
                  style={[styles.line, i === activeIdx && { backgroundColor: colors.primarySoft }]}
                >
                  <AppText variant="meta" tone="primary" numeric style={styles.stamp}>
                    {formatDuration(l.t)}
                  </AppText>
                  <AppText variant="secondary" tone="body" style={styles.flex}>
                    {l.text}
                  </AppText>
                </Pressable>
              ))}
              {lines.length > shown && (
                <Button label={`+ ${lines.length - shown}`} variant="ghost" onPress={() => setShown((n) => n + PAGE)} />
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export function SummaryView({
  summary,
  meta,
  onCreate,
}: {
  summary: NonNullable<Attachment['summary_json']>;
  meta?: AudioMeta;
  onCreate?: (index: number) => string | undefined;
}) {
  const { colors } = useTheme();
  const [created, setCreated] = useState<Record<string, string>>(meta?.created_tasks ?? {});
  const create = (i: number) => {
    const id = onCreate?.(i);
    if (id) {
      setCreated((c) => ({ ...c, [i]: id }));
      showToast(vi.transcript.taskCreated, {
        action: { label: vi.notes.openTask, onPress: () => router.push({ pathname: '/task/[id]', params: { id } }) },
      });
    }
  };
  const remaining = summary.homework.map((_, i) => i).filter((i) => !created[i]);
  return (
    <View style={[styles.summary, { backgroundColor: colors.primarySoft }]}>
      {summary.main_points.length > 0 && (
        <View style={styles.gapXs}>
          <AppText variant="meta" tone="primary">
            {vi.transcript.mainPoints.toUpperCase()}
          </AppText>
          {summary.main_points.map((p, i) => (
            <View key={i} style={styles.bullet}>
              <AppText variant="secondary" tone="body">
                •
              </AppText>
              <AppText variant="secondary" tone="heading" style={styles.flex}>
                {p}
              </AppText>
            </View>
          ))}
        </View>
      )}
      {summary.key_terms.length > 0 && (
        <View style={styles.gapXs}>
          <AppText variant="meta" tone="primary">
            {vi.transcript.keyTerms.toUpperCase()}
          </AppText>
          {summary.key_terms.map((k, i) => (
            <AppText key={i} variant="secondary" tone="body">
              <AppText variant="secondary" tone="heading" style={styles.bold}>
                {k.term}
              </AppText>
              {k.explanation ? ` — ${k.explanation}` : ''}
            </AppText>
          ))}
        </View>
      )}
      {summary.homework.length > 0 && (
        <View style={styles.gapXs}>
          <AppText variant="meta" tone="primary">
            {vi.transcript.homework.toUpperCase()}
          </AppText>
          {summary.homework.map((h, i) => (
            <View key={i} style={styles.row}>
              <View style={styles.flex}>
                <AppText variant="secondary" tone="heading">
                  {h.title}
                </AppText>
                {h.deadline_hint ? (
                  <AppText variant="meta" tone="warning">
                    {h.deadline_hint}
                  </AppText>
                ) : null}
              </View>
              {onCreate &&
                (created[i] ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={vi.notes.openTask}
                    onPress={() => router.push({ pathname: '/task/[id]', params: { id: created[i]! } })}
                    style={styles.iconBtn}
                  >
                    <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                  </Pressable>
                ) : (
                  <Button label={vi.transcript.createTask} variant="secondary" onPress={() => create(i)} />
                ))}
            </View>
          ))}
          {onCreate && remaining.length > 1 && (
            <Button label={vi.transcript.createAll} variant="ghost" onPress={() => remaining.forEach(create)} />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dim: { opacity: 0.4 },
  bold: { fontWeight: '600' },
  card: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  gapXs: { gap: spacing.xs },
  gapSm: { gap: spacing.sm },
  gapMd: { gap: spacing.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
  play: { width: touchTarget, height: touchTarget, borderRadius: touchTarget / 2, alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, height: touchTarget, justifyContent: 'center' },
  rail: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  marker: { position: 'absolute', width: 3, height: 14, marginLeft: -1.5, borderRadius: 1.5, top: touchTarget / 2 - 7 },
  knob: { position: 'absolute', width: 14, height: 14, borderRadius: 7, marginLeft: -7, top: touchTarget / 2 - 7 },
  iconBtn: { minWidth: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.chip,
  },
  line: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 4, paddingHorizontal: spacing.xs, borderRadius: radius.block },
  stamp: { width: 52, paddingTop: 2 },
  summary: { borderRadius: radius.card, padding: spacing.md, gap: spacing.md },
  retention: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  retentionText: { flexGrow: 1, flexShrink: 1, flexBasis: 180 },
  bullet: { flexDirection: 'row', gap: spacing.sm },
});
