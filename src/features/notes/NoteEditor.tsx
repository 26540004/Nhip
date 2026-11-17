/**
 * Rich note editor (iOS + web, no WebView). Content is a list of blocks stored as JSON
 * (src/lib/notes/doc.ts): headings, paragraphs with **đậm** / _nghiêng_, bullet / numbered
 * lists, checklists (a line can become a task), images, link cards and recordings.
 * Autosaves 2 s after the last change and shows "Đã lưu".
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { AutoGrowInput } from '../../components/AutoGrowInput';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { CollectionPicker, SpacePicker } from '../../components/FieldEditors';
import { showToast } from '../../components/Toast';
import { vi } from '../../i18n/vi';
import { confirmDestructive } from '../../lib/confirm';
import { enqueueWrite, newId, useCreateTasks, useDeleteNote, useUpdateNote } from '../../lib/api/mutations';
import { useAttachments, useCollections, useNote, useSettings } from '../../lib/api/queries';
import type { Note, TranscriptSummary } from '../../lib/api/types';
import {
  type Block,
  blockId,
  docToPlainText,
  insertMedia,
  isTextBlock,
  mergeBackward,
  type NoteDoc,
  normalizeDoc,
  numberingOf,
  removeBlock,
  setBlockType,
  splitBlock,
  type TextBlock,
  type TextBlockType,
  toggleMark,
  updateBlock,
} from '../../lib/notes/doc';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing, touchTarget } from '../../theme/tokens';
import { type as typeScale } from '../../theme/typography';
import { useMediaActions } from '../media/actions';
import { useRecorderStore } from '../record/store';
import { type BlockHandle, MediaBlockView, type Selection, TextBlockView } from './BlockView';
import { EditorToolbar } from './EditorToolbar';
import { ImageSourceSheet, LinkSheet, NoteAiSheet } from './NoteSheets';

const AUTOSAVE_MS = 2000;

export function NoteEditor({ noteId, onClose }: { noteId: string; onClose: () => void }) {
  const q = useNote(noteId);
  if (!q.data) {
    return (
      <View style={styles.center}>
        <AppText variant="body" tone="muted">
          {q.isLoading ? vi.states.loading : vi.common.notFound}
        </AppText>
        {!q.isLoading && <Button label={vi.common.back} variant="secondary" onPress={onClose} />}
      </View>
    );
  }
  return <Editor key={q.data.id} note={q.data} onClose={onClose} />;
}

function Editor({ note, onClose }: { note: Note; onClose: () => void }) {
  const { colors } = useTheme();
  const qc = useQueryClient();
  const collections = useCollections().data ?? [];
  const privacy = Boolean(useSettings().data?.profile?.ai_privacy_mode);
  const attachmentsQ = useAttachments(note.id);
  const attachments = attachmentsQ.data ?? [];
  const update = useUpdateNote();
  const del = useDeleteNote();
  const createTasks = useCreateTasks();
  const owner = useMemo(() => ({ type: 'note' as const, id: note.id }), [note.id]);
  const media = useMediaActions(owner);

  const [title, setTitle] = useState(note.title);
  const [doc, setDoc] = useState<NoteDoc>(() => normalizeDoc(note.content_json, note.plain_text));
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [showMeta, setShowMeta] = useState(false);
  const [sheet, setSheet] = useState<'image' | 'link' | 'ai' | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ title, doc });
  const saved = useRef({ title: note.title, json: JSON.stringify(note.content_json) });
  const lastFocus = useRef<string | null>(null);
  const selections = useRef(new Map<string, Selection>());
  const handles = useRef(new Map<string, BlockHandle>());
  const pendingFocus = useRef<{ id: string; caret?: number } | null>(null);
  useEffect(() => {
    latest.current = { title, doc };
  }, [title, doc]);

  // ----- saving ------------------------------------------------------------
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { title: t, doc: d } = latest.current;
    const json = JSON.stringify(d);
    if (t === saved.current.title && json === saved.current.json) {
      setStatus('saved');
      return;
    }
    saved.current = { title: t, json };
    setStatus('saving');
    await update
      .mutateAsync({ id: note.id, patch: { title: t, content_json: d, plain_text: docToPlainText(d) } })
      .catch(() => undefined)
      .finally(() => setStatus('saved'));
  }, [note.id, update]);

  const schedule = useCallback(() => {
    setStatus('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
  }, [flush]);

  const change = useCallback(
    (next: NoteDoc | ((d: NoteDoc) => NoteDoc), focus?: { id: string; caret?: number }) => {
      setDoc((d) => {
        const n = typeof next === 'function' ? next(d) : next;
        latest.current = { ...latest.current, doc: n };
        return n;
      });
      if (focus) pendingFocus.current = focus;
      schedule();
    },
    [schedule],
  );

  // Save when leaving the editor or backgrounding the app.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && timer.current && void flush());
    return () => {
      sub.remove();
      if (timer.current) void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply focus requests as soon as the new block is mounted (before paint).
  useLayoutEffect(() => {
    const f = pendingFocus.current;
    if (!f) return;
    pendingFocus.current = null;
    handles.current.get(f.id)?.focus(f.caret);
  });

  // An audio block whose recording never started (user left the recorder) is removed.
  useFocusEffect(
    useCallback(() => {
      const st = useRecorderStore.getState();
      const gone = st.abandoned.filter((id) => latest.current.doc.blocks.some((b) => !isTextBlock(b) && b.attachmentId === id));
      if (gone.length) {
        change((d) => ({ ...d, blocks: d.blocks.filter((b) => isTextBlock(b) || !gone.includes(b.attachmentId)) }));
        st.set({ abandoned: st.abandoned.filter((id) => !gone.includes(id)) });
      }
    }, [change]),
  );

  // ----- block operations --------------------------------------------------
  const ordinals = useMemo(() => numberingOf(doc), [doc]);
  const activeBlock = doc.blocks.find((b) => b.id === focusId);
  const targetId = () => lastFocus.current ?? [...doc.blocks].reverse().find(isTextBlock)?.id ?? null;

  const onChangeText = (b: TextBlock, text: string) => {
    if (!text.includes('\n')) {
      change((d) => updateBlock(d, b.id, { text }));
      return;
    }
    const lines = text.split('\n');
    if (lines.length === 2) {
      // Enter: split at the caret (lists continue; an empty item ends the list).
      const offset = lines[0]!.length;
      change((d) => {
        const r = splitBlock(updateBlock(d, b.id, { text: lines.join('') }), b.id, offset);
        pendingFocus.current = { id: r.focusId, caret: 0 };
        return r.doc;
      }, undefined);
      return;
    }
    // Pasted several lines: one block per line, same type.
    change((d) => {
      const i = d.blocks.findIndex((x) => x.id === b.id);
      const extra: TextBlock[] = lines.slice(1).map((t) => ({
        id: blockId(),
        type: b.type === 'h1' || b.type === 'h2' ? 'p' : b.type,
        text: t,
        ...(b.type === 'check' ? { checked: false, taskId: null } : {}),
      }));
      const blocks: Block[] = [...d.blocks];
      blocks[i] = { ...b, text: lines[0]! };
      blocks.splice(i + 1, 0, ...extra);
      const last = extra[extra.length - 1]!;
      pendingFocus.current = { id: last.id, caret: last.text.length };
      return { ...d, blocks };
    });
  };

  const onBackspaceAtStart = (b: TextBlock) => {
    const idx = doc.blocks.findIndex((x) => x.id === b.id);
    if (idx === 0 && b.type === 'p') return;
    const r = mergeBackward(doc, b.id);
    change(r.doc, { id: r.focusId, caret: r.caret });
  };

  const applyType = (t: TextBlockType) => {
    const id = targetId();
    if (!id) return;
    change((d) => setBlockType(d, id, t), { id });
  };

  const applyMark = (m: 'bold' | 'italic', id = targetId()) => {
    const b = doc.blocks.find((x) => x.id === id);
    if (!b || !isTextBlock(b)) return;
    const sel = selections.current.get(b.id) ?? { start: b.text.length, end: b.text.length };
    const r = toggleMark(b.text, sel, m);
    selections.current.set(b.id, r.selection);
    change((d) => updateBlock(d, b.id, { text: r.text }), { id: b.id, caret: r.selection.end });
  };

  const insertAfterFocus = (type: 'image' | 'link' | 'audio', attachmentId: string) => {
    const after = lastFocus.current;
    change((d) => {
      const r = insertMedia(d, after, type, attachmentId);
      lastFocus.current = r.focusId;
      return r.doc;
    });
  };

  const removeMedia = async (blockIdToRemove: string, attachmentId: string) => {
    if (!(await confirmDestructive(vi.common.confirmDelete))) return;
    change((d) => removeBlock(d, blockIdToRemove));
    void enqueueWrite(qc, 'attachmentDelete', attachmentId).catch(() => undefined);
  };

  const convertToTask = (b: TextBlock) => {
    const id = newId();
    createTasks.mutate([
      {
        id,
        title: b.text.replace(/\*\*|_/g, '').trim(),
        space: note.space,
        collection_id: note.collection_id,
        source: 'note',
        source_note_id: note.id,
      },
    ]);
    change((d) => updateBlock(d, b.id, { taskId: id }));
    showToast(vi.notes.convertedToTask, {
      action: { label: vi.notes.openTask, onPress: () => router.push({ pathname: '/task/[id]', params: { id } }) },
    });
  };

  const startRecording = async () => {
    const att = newId();
    insertAfterFocus('audio', att);
    await flush();
    router.push({ pathname: '/record', params: { note: note.id, att } });
  };

  const insertSummary = (s: TranscriptSummary) => {
    const blocks: TextBlock[] = [
      { id: blockId(), type: 'h2', text: vi.notes.ai.summaryHeading },
      ...s.main_points.map((p): TextBlock => ({ id: blockId(), type: 'bullet', text: p })),
      ...s.key_terms.map((k): TextBlock => ({ id: blockId(), type: 'bullet', text: `**${k.term}** — ${k.explanation}` })),
      ...s.homework.map((h): TextBlock => ({
        id: blockId(),
        type: 'check',
        text: h.deadline_hint ? `${h.title} (${h.deadline_hint})` : h.title,
        checked: false,
        taskId: null,
      })),
    ];
    change((d) => ({ ...d, blocks: [...d.blocks, ...blocks] }));
  };

  const remove = async () => {
    if (!(await confirmDestructive(vi.common.confirmDelete))) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    del.mutate(note.id);
    onClose();
  };

  const col = collections.find((c) => c.id === note.collection_id);
  const taskContext = { space: note.space, collection_id: note.collection_id, source_note_id: note.id };
  const onlyEmpty = doc.blocks.length === 1 && isTextBlock(doc.blocks[0]!) && (doc.blocks[0] as TextBlock).text === '';

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" stickyHeaderIndices={[1]}>
        <View style={styles.gap}>
          <View style={styles.header}>
            <AppText variant="meta" tone="muted" accessibilityLiveRegion="polite">
              {status === 'saved' ? vi.common.saved : vi.common.saving}
            </AppText>
            <View style={styles.inline}>
              <Chip
                label={col?.name ?? vi.space[note.space]}
                tone={note.space}
                icon="folder-outline"
                onPress={() => setShowMeta((v) => !v)}
              />
              <IconToggle
                icon={note.pinned ? 'pin' : 'pin-outline'}
                label={note.pinned ? vi.notes.unpin : vi.notes.pin}
                active={note.pinned}
                onPress={() => update.mutate({ id: note.id, patch: { pinned: !note.pinned } })}
              />
              <IconToggle icon="trash-outline" label={vi.notes.deleteNote} onPress={() => void remove()} />
            </View>
          </View>
          {showMeta && (
            <View style={styles.meta}>
              <SpacePicker value={note.space} onChange={(s) => update.mutate({ id: note.id, patch: { space: s, collection_id: null } })} />
              <CollectionPicker
                space={note.space}
                collections={collections}
                value={note.collection_id}
                onChange={(id) => update.mutate({ id: note.id, patch: { collection_id: id } })}
              />
            </View>
          )}
        </View>

        <EditorToolbar
          activeType={activeBlock && isTextBlock(activeBlock) ? activeBlock.type : null}
          onType={applyType}
          onMark={(m) => applyMark(m)}
          onImage={() => setSheet('image')}
          onAudio={() => void startRecording()}
          onLink={() => setSheet('link')}
          onAi={() => setSheet('ai')}
        />

        <View style={styles.gap}>
          <AutoGrowInput
            value={title}
            onChangeText={(v) => {
              setTitle(v.replace(/\n/g, ' '));
              latest.current = { ...latest.current, title: v.replace(/\n/g, ' ') };
              schedule();
            }}
            placeholder={vi.notes.titlePlaceholder}
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.primary}
            accessibilityLabel={vi.notes.titlePlaceholder}
            textStyle={[typeScale.screenTitle, styles.title, { color: colors.textHeading }]}
            blurOnSubmit
            onSubmitEditing={() => {
              const first = doc.blocks.find(isTextBlock);
              if (first) handles.current.get(first.id)?.focus(0);
            }}
          />

          <View style={styles.blocks}>
            {doc.blocks.map((b, i) =>
              isTextBlock(b) ? (
                <TextBlockView
                  key={b.id}
                  ref={(h) => {
                    if (h) handles.current.set(b.id, h);
                    else handles.current.delete(b.id);
                  }}
                  block={b}
                  ordinal={ordinals.get(b.id)}
                  placeholder={i === 0 && onlyEmpty ? vi.notes.bodyPlaceholder : undefined}
                  onChangeText={(t) => onChangeText(b, t)}
                  onBackspaceAtStart={() => onBackspaceAtStart(b)}
                  onFocus={() => {
                    lastFocus.current = b.id;
                    setFocusId(b.id);
                  }}
                  onSelection={(s) => selections.current.set(b.id, s)}
                  onToggleCheck={(v) => change((d) => updateBlock(d, b.id, { checked: v }))}
                  onConvert={() => convertToTask(b)}
                  onShortcut={(m) => applyMark(m, b.id)}
                />
              ) : (
                <MediaBlockView
                  key={b.id}
                  block={b}
                  attachment={attachments.find((a) => a.id === b.attachmentId)}
                  loading={attachmentsQ.isLoading}
                  taskContext={taskContext}
                  onRemove={() => void removeMedia(b.id, b.attachmentId)}
                />
              ),
            )}
          </View>

          {/* Tap below the content to keep writing. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={vi.notes.bodyPlaceholder}
            style={styles.tail}
            onPress={() => {
              const last = doc.blocks[doc.blocks.length - 1];
              if (last && isTextBlock(last) && last.text === '') handles.current.get(last.id)?.focus();
              else {
                const id = blockId();
                change((d) => ({ ...d, blocks: [...d.blocks, { id, type: 'p', text: '' }] }), { id });
              }
            }}
          />
        </View>
      </ScrollView>

      <ImageSourceSheet
        visible={sheet === 'image'}
        onClose={() => setSheet(null)}
        onPick={(src) => {
          setSheet(null);
          void media.addImages(src).then((ids) => ids.forEach((id) => insertAfterFocus('image', id)));
        }}
      />
      <LinkSheet
        visible={sheet === 'link'}
        onClose={() => setSheet(null)}
        onAdd={(url) => {
          setSheet(null);
          insertAfterFocus('link', media.addLink(url));
        }}
      />
      <NoteAiSheet
        visible={sheet === 'ai'}
        onClose={() => setSheet(null)}
        note={note}
        privacy={privacy}
        beforeCall={flush}
        onInsertSummary={insertSummary}
      />
    </>
  );
}

function IconToggle({
  icon,
  label,
  onPress,
  active,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={styles.icon}
    >
      <Ionicons name={icon} size={20} color={active ? colors.primary : colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 200, gap: spacing.md },
  gap: { gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  meta: { gap: spacing.sm },
  title: { outlineStyle: 'none' } as object,
  blocks: { gap: spacing.sm },
  tail: { minHeight: 120 },
  icon: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
});
