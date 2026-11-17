/**
 * One block of the note editor. Text blocks are plain TextInputs (iOS + web, no WebView);
 * a block that contains **đậm** / _nghiêng_ marks shows them styled until it is tapped.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  type TextInputInstance,
  type TextInputKeyPressEvent,
  type TextInputSelectionChangeEvent,
  View,
} from 'react-native';
import { AppText } from '../../components/AppText';
import { AutoGrowInput } from '../../components/AutoGrowInput';
import { Checkbox } from '../../components/Checkbox';
import { vi } from '../../i18n/vi';
import type { Attachment } from '../../lib/api/types';
import { type MediaBlock, parseInline, type TextBlock } from '../../lib/notes/doc';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../../theme/tokens';
import { type as typeScale } from '../../theme/typography';
import { AudioCard, type TaskContext } from '../media/AudioCard';
import { ImageThumb } from '../media/ImageThumb';
import { LinkCard } from '../media/LinkCard';

/** True when the input exists and is not already focused (avoids re-focusing on every render). */
function document_hasNoFocusInside(el: unknown): boolean {
  if (!el) return false;
  const active = (globalThis as { document?: { activeElement?: unknown } }).document?.activeElement;
  const isFocused = (el as { isFocused?: () => boolean }).isFocused?.();
  return active !== undefined ? active !== el : !isFocused;
}

export interface BlockHandle {
  focus: (caret?: number) => void;
}

export interface Selection {
  start: number;
  end: number;
}

interface TextBlockProps {
  block: TextBlock;
  ordinal?: number;
  placeholder?: string;
  onChangeText: (text: string) => void;
  onBackspaceAtStart: () => void;
  onFocus: () => void;
  onSelection: (sel: Selection) => void;
  onToggleCheck: (checked: boolean) => void;
  onConvert: () => void;
  onShortcut: (mark: 'bold' | 'italic') => void;
}

export function TextBlockView({ ref, ...props }: TextBlockProps & { ref?: Ref<BlockHandle> }) {
  const { block } = props;
  const { colors } = useTheme();
  const input = useRef<TextInputInstance>(null);
  const sel = useRef<Selection>({ start: block.text.length, end: block.text.length });
  const [editing, setEditing] = useState(false);
  const hasMarks = /\*\*.+?\*\*|_.+?_/.test(block.text);
  const showStyled = hasMarks && !editing;

  const pendingCaret = useRef<number | null>(null);
  const place = (caret: number | null) => {
    const el = input.current as unknown as {
      focus?: () => void;
      setSelection?: (a: number, b: number) => void;
      setSelectionRange?: (a: number, b: number) => void;
    } | null;
    if (!el) return false;
    el.focus?.();
    if (caret != null) {
      if (el.setSelectionRange) el.setSelectionRange(caret, caret);
      else el.setSelection?.(caret, caret);
      sel.current = { start: caret, end: caret };
    }
    return true;
  };

  useImperativeHandle(ref, () => ({
    // Focus synchronously so keystrokes typed right after Enter land in the new block.
    focus: (caret?: number) => {
      if (place(caret ?? null)) return;
      pendingCaret.current = caret ?? null;
      setEditing(true); // styled block → input; the effect below focuses it
    },
  }));

  useEffect(() => {
    if (editing && !showStyled && document_hasNoFocusInside(input.current)) {
      place(pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [editing, showStyled]);

  const style = [
    block.type === 'h1' ? typeScale.section : block.type === 'h2' ? typeScale.listTitle : typeScale.body,
    { color: block.type === 'h1' || block.type === 'h2' ? colors.textHeading : colors.textBody },
    block.type === 'check' && (block.checked || block.taskId)
      ? { color: colors.textMuted, textDecorationLine: 'line-through' as const }
      : null,
    styles.text,
  ];

  const prefix =
    block.type === 'bullet' ? (
      <AppText variant="body" tone="muted" style={styles.marker}>
        •
      </AppText>
    ) : block.type === 'number' ? (
      <AppText variant="body" tone="muted" numeric style={styles.marker}>
        {props.ordinal ?? 1}.
      </AppText>
    ) : block.type === 'check' ? (
      <View style={styles.checkWrap}>
        <Checkbox checked={Boolean(block.checked)} label={block.text || vi.notes.checklist} onChange={props.onToggleCheck} />
      </View>
    ) : null;

  const onKeyPress = (e: TextInputKeyPressEvent) => {
    const ne = e.nativeEvent as TextInputKeyPressEvent['nativeEvent'] & { metaKey?: boolean; ctrlKey?: boolean };
    if (ne.key === 'Backspace' && sel.current.start === 0 && sel.current.end === 0) props.onBackspaceAtStart();
    if ((ne.metaKey || ne.ctrlKey) && (ne.key === 'b' || ne.key === 'i')) {
      (e as unknown as { preventDefault?: () => void }).preventDefault?.();
      props.onShortcut(ne.key === 'b' ? 'bold' : 'italic');
    }
  };

  return (
    <View style={[styles.row, block.type === 'h1' && styles.h1Row]}>
      {prefix}
      {showStyled ? (
        <Pressable accessibilityRole="text" onPress={() => setEditing(true)} style={styles.flex}>
          <Text style={style}>
            {parseInline(block.text).map((s, i) => (
              <Text key={i} style={[s.bold && styles.bold, s.italic && styles.italic]}>
                {s.text}
              </Text>
            ))}
          </Text>
        </Pressable>
      ) : (
        <AutoGrowInput
          ref={input}
          value={block.text}
          onChangeText={props.onChangeText}
          onKeyPress={onKeyPress}
          onFocus={() => {
            setEditing(true);
            props.onFocus();
          }}
          onBlur={() => setEditing(false)}
          onSelectionChange={(e: TextInputSelectionChangeEvent) => {
            sel.current = e.nativeEvent.selection;
            props.onSelection(e.nativeEvent.selection);
          }}
          placeholder={props.placeholder}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primary}
          accessibilityLabel={props.placeholder ?? vi.notes.format[block.type === 'p' ? 'toolbar' : block.type]}
          textStyle={[style, styles.input]}
        />
      )}
      {block.type === 'check' &&
        block.text.trim() !== '' &&
        (block.taskId ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={block.taskId === 'converted' ? vi.notes.convertedToTask : vi.notes.openTask}
            disabled={block.taskId === 'converted'}
            onPress={() => router.push({ pathname: '/task/[id]', params: { id: block.taskId! } })}
            style={styles.side}
          >
            <Ionicons name="arrow-forward-circle" size={20} color={colors.success} />
          </Pressable>
        ) : (
          !block.checked && (
            <Pressable accessibilityRole="button" accessibilityLabel={vi.notes.toTask} onPress={props.onConvert} style={styles.side}>
              <Ionicons name="checkbox-outline" size={18} color={colors.primary} />
            </Pressable>
          )
        ))}
    </View>
  );
}

export function MediaBlockView({
  block,
  attachment,
  loading,
  taskContext,
  onRemove,
}: {
  block: MediaBlock;
  attachment: Attachment | undefined;
  loading: boolean;
  taskContext: TaskContext;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  if (!attachment) {
    if (loading) return <View style={[styles.missing, { borderColor: colors.border }]} />;
    return (
      <View style={[styles.missing, styles.rowCenter, { borderColor: colors.border }]}>
        <AppText variant="secondary" tone="muted" style={styles.flex}>
          {vi.notes.missingAttachment}
        </AppText>
        <RemoveButton onPress={onRemove} />
      </View>
    );
  }
  if (block.type === 'audio') return <AudioCard attachment={attachment} taskContext={taskContext} onRemove={onRemove} />;
  return (
    <View>
      {block.type === 'image' ? (
        <ImageThumb attachment={attachment} onLongPress={onRemove} />
      ) : (
        <LinkCard attachment={attachment} onLongPress={onRemove} />
      )}
      <View style={styles.corner}>
        <RemoveButton onPress={onRemove} overlay />
      </View>
    </View>
  );
}

function RemoveButton({ onPress, overlay }: { onPress: () => void; overlay?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={vi.notes.removeBlock}
      onPress={onPress}
      hitSlop={6}
      style={[styles.remove, overlay && { backgroundColor: 'rgba(14,17,22,0.7)' }]}
    >
      <Ionicons name="close" size={16} color={overlay ? '#F2F4F7' : colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  h1Row: { marginTop: spacing.sm },
  text: { paddingVertical: 4 },
  input: { outlineStyle: 'none' } as object,
  marker: { width: 22, textAlign: 'right', paddingTop: 4, paddingRight: 4 },
  checkWrap: { marginTop: -8, marginLeft: -10 },
  side: { width: touchTarget, height: 32, alignItems: 'center', justifyContent: 'center' },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  missing: { minHeight: 56, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, borderStyle: 'dashed' },
  corner: { position: 'absolute', top: spacing.sm, right: spacing.sm },
  remove: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
