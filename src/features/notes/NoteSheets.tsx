/** Sheets used by the note editor: add image (camera / library), add link, and ✦ AI. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { formatDeadlineShort } from '../../components/FieldEditors';
import { Sheet } from '../../components/Sheet';
import { TextField } from '../../components/TextField';
import { showToast } from '../../components/Toast';
import { vi } from '../../i18n/vi';
import { noteExtractTasks, noteSummarize } from '../../lib/api/functions';
import { newId, useCreateTasks } from '../../lib/api/mutations';
import type { Note, ParsedTask, TranscriptSummary } from '../../lib/api/types';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing } from '../../theme/tokens';
import { errorText, SummaryView } from '../media/AudioCard';
import { normalizeUrl } from '../media/actions';

type Icon = React.ComponentProps<typeof Ionicons>['name'];

function Option({
  icon,
  title,
  help,
  onPress,
  disabled,
}: {
  icon: Icon;
  title: string;
  help?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.option, { backgroundColor: colors.surface2, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      <Ionicons name={icon} size={22} color={colors.primary} />
      <View style={styles.flex}>
        <AppText variant="body" tone="heading">
          {title}
        </AppText>
        {help ? (
          <AppText variant="secondary" tone="muted">
            {help}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

export function ImageSourceSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (s: 'camera' | 'library') => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} label={vi.notes.format.image}>
      <View style={styles.gap}>
        <AppText variant="section">{vi.notes.format.image}</AppText>
        {Platform.OS !== 'web' && <Option icon="camera-outline" title={vi.notes.format.camera} onPress={() => onPick('camera')} />}
        <Option icon="images-outline" title={vi.notes.format.library} onPress={() => onPick('library')} />
      </View>
    </Sheet>
  );
}

export function LinkSheet({ visible, onClose, onAdd }: { visible: boolean; onClose: () => void; onAdd: (url: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const url = normalizeUrl(value);
    if (!url) {
      setError(vi.notes.linkInvalid);
      return;
    }
    onAdd(url);
    setValue('');
    setError(null);
  };
  return (
    <Sheet visible={visible} onClose={onClose} label={vi.notes.format.link}>
      <View style={styles.gap}>
        <AppText variant="section">{vi.notes.format.link}</AppText>
        <TextField
          label={vi.notes.linkPrompt}
          value={value}
          onChangeText={(v) => {
            setValue(v);
            setError(null);
          }}
          placeholder={vi.notes.linkPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          autoFocus
          onSubmitEditing={submit}
          error={error}
        />
        <Button label={vi.common.add} onPress={submit} />
      </View>
    </Sheet>
  );
}

type AiState =
  | { kind: 'menu' }
  | { kind: 'working' }
  | { kind: 'summary'; summary: TranscriptSummary }
  | { kind: 'tasks'; tasks: ParsedTask[]; picked: boolean[] };

export function NoteAiSheet({
  visible,
  onClose,
  note,
  privacy,
  beforeCall,
  onInsertSummary,
}: {
  visible: boolean;
  onClose: () => void;
  note: Note;
  privacy: boolean;
  /** Save pending edits first: the server reads the note from the database. */
  beforeCall: () => Promise<void>;
  onInsertSummary: (s: TranscriptSummary) => void;
}) {
  const { colors } = useTheme();
  const createTasks = useCreateTasks();
  const [state, setState] = useState<AiState>({ kind: 'menu' });
  const close = () => {
    setState({ kind: 'menu' });
    onClose();
  };

  const run = async (action: 'summarize' | 'extract') => {
    setState({ kind: 'working' });
    try {
      await beforeCall();
      if (action === 'summarize') {
        const res = await noteSummarize(note.id);
        setState({ kind: 'summary', summary: res.summary });
      } else {
        const res = await noteExtractTasks(note.id);
        setState({ kind: 'tasks', tasks: res.tasks, picked: res.tasks.map(() => true) });
      }
    } catch (e) {
      showToast(errorText(e), { tone: 'error' });
      setState({ kind: 'menu' });
    }
  };

  const createPicked = (s: Extract<AiState, { kind: 'tasks' }>) => {
    const rows = s.tasks
      .filter((_, i) => s.picked[i])
      .map((t) => ({
        id: newId(),
        title: t.title,
        space: t.space,
        collection_id: t.collection_id ?? note.collection_id,
        deadline_at: t.deadline_at,
        estimate_minutes: t.estimate_minutes,
        priority: t.priority,
        priority_reason: t.priority_reason || null,
        source: 'note' as const,
        source_note_id: note.id,
      }));
    if (rows.length === 0) return;
    createTasks.mutate(rows);
    showToast(vi.notes.ai.created(rows.length));
    close();
  };

  return (
    <Sheet visible={visible} onClose={close} label={vi.notes.ai.title}>
      <View style={styles.gap}>
        <AppText variant="section">{vi.notes.ai.title}</AppText>
        {privacy ? (
          <AppText variant="body" tone="muted">
            {vi.notes.ai.privacy}
          </AppText>
        ) : state.kind === 'menu' ? (
          <>
            <Option
              icon="list-outline"
              title={vi.notes.ai.summarize}
              help={vi.notes.ai.summarizeHelp}
              onPress={() => void run('summarize')}
            />
            <Option
              icon="checkbox-outline"
              title={vi.notes.ai.extract}
              help={vi.notes.ai.extractHelp}
              onPress={() => void run('extract')}
            />
          </>
        ) : state.kind === 'working' ? (
          <View style={[styles.working, { backgroundColor: colors.primarySoft }]} accessibilityLiveRegion="polite">
            <Ionicons name="sparkles" size={18} color={colors.primary} />
            <AppText variant="body" tone="primary">
              {vi.notes.ai.working}
            </AppText>
          </View>
        ) : state.kind === 'summary' ? (
          <>
            <SummaryView summary={state.summary} />
            <Button
              label={vi.notes.ai.insert}
              onPress={() => {
                onInsertSummary(state.summary);
                showToast(vi.notes.ai.inserted);
                close();
              }}
            />
          </>
        ) : state.tasks.length === 0 ? (
          <AppText variant="body" tone="muted">
            {vi.notes.ai.noTasks}
          </AppText>
        ) : (
          <>
            {state.tasks.map((t, i) => (
              <View key={i} style={styles.taskRow}>
                <Checkbox
                  checked={state.picked[i] ?? false}
                  label={t.title}
                  onChange={(v) => setState({ ...state, picked: state.picked.map((p, j) => (j === i ? v : p)) })}
                />
                <View style={styles.flex}>
                  <AppText variant="body" tone="heading">
                    {t.title}
                  </AppText>
                  {(t.deadline_at || t.estimate_minutes) && (
                    <AppText variant="meta" tone="muted">
                      {[t.deadline_at ? formatDeadlineShort(t.deadline_at) : null, t.estimate_minutes ? `${t.estimate_minutes} phút` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </AppText>
                  )}
                </View>
              </View>
            ))}
            <Button label={vi.notes.ai.createSelected(state.picked.filter(Boolean).length)} onPress={() => createPicked(state)} />
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: spacing.md },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.card },
  working: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.card },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
