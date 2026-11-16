/**
 * Note editor (Phase 2: plain text with checklists). Autosaves 2 s after the last keystroke
 * and shows "Đã lưu". Checklist lines can be turned into tasks linked to the note.
 * Rich formatting, images and audio arrive with the cross-platform editor in Phase 5.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { Chip } from '../../components/Chip';
import { CollectionPicker, SpacePicker } from '../../components/FieldEditors';
import { showToast } from '../../components/Toast';
import { vi } from '../../i18n/vi';
import { confirmDestructive } from '../../lib/confirm';
import { newId, useCreateTasks, useDeleteNote, useUpdateNote } from '../../lib/api/mutations';
import { useCollections, useNote } from '../../lib/api/queries';
import type { Note } from '../../lib/api/types';
import { bodyFromContent, markConverted, parseChecklist, toggleChecked } from '../../lib/notes/checklist';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing, touchTarget } from '../../theme/tokens';
import { type as typeScale } from '../../theme/typography';

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
  const collections = useCollections().data ?? [];
  const update = useUpdateNote();
  const del = useDeleteNote();
  const createTasks = useCreateTasks();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(bodyFromContent(note.content_json, note.plain_text));
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [showMeta, setShowMeta] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ title, body });
  useEffect(() => {
    latest.current = { title, body };
  }, [title, body]);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { title: t, body: b } = latest.current;
    if (t === note.title && b === bodyFromContent(note.content_json, note.plain_text)) {
      setStatus('saved');
      return;
    }
    setStatus('saving');
    update.mutate(
      { id: note.id, patch: { title: t, plain_text: b, content_json: { type: 'plain', text: b } } },
      { onSettled: () => setStatus('saved') },
    );
  };

  const schedule = () => {
    setStatus('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_MS);
  };

  // Save pending edits when leaving the editor.
  useEffect(
    () => () => {
      if (timer.current) flush();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const checklist = parseChecklist(body);

  const convert = (index: number, text: string) => {
    createTasks.mutate([
      { id: newId(), title: text, space: note.space, collection_id: note.collection_id, source: 'note', source_note_id: note.id },
    ]);
    setBody((b) => markConverted(b, index));
    schedule();
    showToast(vi.notes.convertedToTask);
  };

  const remove = async () => {
    if (!(await confirmDestructive(vi.common.confirmDelete))) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    del.mutate(note.id);
    onClose();
  };

  const col = collections.find((c) => c.id === note.collection_id);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.toolbar}>
        <AppText variant="meta" tone="muted" accessibilityLiveRegion="polite">
          {status === 'saved' ? vi.common.saved : vi.common.saving}
        </AppText>
        <View style={styles.inline}>
          <Chip label={col?.name ?? vi.space[note.space]} tone={note.space} icon="folder-outline" onPress={() => setShowMeta((v) => !v)} />
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

      <TextInput
        value={title}
        onChangeText={(v) => {
          setTitle(v);
          schedule();
        }}
        onBlur={flush}
        placeholder={vi.notes.titlePlaceholder}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.primary}
        accessibilityLabel={vi.notes.titlePlaceholder}
        style={[typeScale.screenTitle, { color: colors.textHeading }]}
        multiline
      />
      <TextInput
        value={body}
        onChangeText={(v) => {
          setBody(v);
          schedule();
        }}
        onBlur={flush}
        placeholder={vi.notes.bodyPlaceholder}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.primary}
        accessibilityLabel={vi.notes.bodyPlaceholder}
        style={[typeScale.body, styles.body, { color: colors.textBody }]}
        multiline
        textAlignVertical="top"
      />

      {checklist.length > 0 && (
        <View style={[styles.checklist, { borderTopColor: colors.border }]}>
          <AppText variant="meta" tone="muted">
            {vi.notes.checklist.toUpperCase()}
          </AppText>
          {checklist.map((l) => (
            <View key={l.index} style={styles.checkRow}>
              <Checkbox
                checked={l.checked}
                label={l.text}
                onChange={(v) => {
                  setBody((b) => toggleChecked(b, l.index, v));
                  schedule();
                }}
              />
              <AppText
                variant="body"
                tone={l.checked || l.converted ? 'muted' : 'heading'}
                style={[styles.flex, l.checked && styles.strike]}
              >
                {l.text}
              </AppText>
              {l.converted ? (
                <Ionicons name="arrow-forward-circle" size={18} color={colors.success} accessibilityLabel={vi.notes.convertedToTask} />
              ) : (
                !l.checked && <Chip label={vi.notes.toTask} icon="checkbox-outline" onPress={() => convert(l.index, l.text)} />
              )}
            </View>
          ))}
        </View>
      )}

      <AppText variant="meta" tone="muted">
        {vi.notes.richEditorLater}
      </AppText>
    </ScrollView>
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
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 160 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  meta: { gap: spacing.sm },
  body: { minHeight: 240 },
  checklist: { borderTopWidth: 1, paddingTop: spacing.md, gap: spacing.xs },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  strike: { textDecorationLine: 'line-through' },
  icon: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
});
