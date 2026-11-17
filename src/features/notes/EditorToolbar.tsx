/** Toolbar: 📷 🎙 🔗 ☑ ✦ AI, then headings, bold/italic and lists. Sticky at the top of the editor. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { vi } from '../../i18n/vi';
import type { TextBlockType } from '../../lib/notes/doc';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../../theme/tokens';

type Icon = React.ComponentProps<typeof Ionicons>['name'];

export interface ToolbarProps {
  activeType: TextBlockType | null;
  onType: (t: TextBlockType) => void;
  onMark: (m: 'bold' | 'italic') => void;
  onImage: () => void;
  onAudio: () => void;
  onLink: () => void;
  onAi: () => void;
}

export function EditorToolbar(p: ToolbarProps) {
  const { colors } = useTheme();
  const item = (key: string, label: string, onPress: () => void, content: { icon?: Icon; text?: string }, active = false, ai = false) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      // Keep the keyboard and the caret where they are (web: no blur on mousedown).
      {...({ onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() } as object)}
      style={({ pressed }) => [
        styles.btn,
        active && { backgroundColor: colors.primarySoft },
        ai && { backgroundColor: colors.primarySoft },
        pressed && { opacity: 0.6 },
      ]}
    >
      {content.icon ? (
        <Ionicons name={content.icon} size={20} color={active || ai ? colors.primary : colors.textHeading} />
      ) : (
        <AppText
          variant="secondary"
          tone={active ? 'primary' : 'heading'}
          style={key === 'bold' ? styles.bold : key === 'italic' ? styles.italic : styles.semibold}
        >
          {content.text}
        </AppText>
      )}
    </Pressable>
  );

  return (
    <View style={[styles.bar, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.row}>
        {item('image', vi.notes.format.image, p.onImage, { icon: 'camera-outline' })}
        {item('audio', vi.notes.format.audio, p.onAudio, { icon: 'mic-outline' })}
        {item('link', vi.notes.format.link, p.onLink, { icon: 'link-outline' })}
        {item('check', vi.notes.format.check, () => p.onType('check'), { icon: 'checkbox-outline' }, p.activeType === 'check')}
        {item('ai', vi.notes.format.ai, p.onAi, { icon: 'sparkles' }, false, true)}
        <View style={[styles.sep, { backgroundColor: colors.border }]} />
        {item('h1', vi.notes.format.h1, () => p.onType('h1'), { text: 'H1' }, p.activeType === 'h1')}
        {item('h2', vi.notes.format.h2, () => p.onType('h2'), { text: 'H2' }, p.activeType === 'h2')}
        {item('bold', vi.notes.format.bold, () => p.onMark('bold'), { text: 'B' })}
        {item('italic', vi.notes.format.italic, () => p.onMark('italic'), { text: 'I' })}
        {item('bullet', vi.notes.format.bullet, () => p.onType('bullet'), { icon: 'list' }, p.activeType === 'bullet')}
        {item('number', vi.notes.format.number, () => p.onType('number'), { text: '1.' }, p.activeType === 'number')}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderBottomWidth: StyleSheet.hairlineWidth, marginHorizontal: -spacing.lg, paddingHorizontal: spacing.md },
  row: { alignItems: 'center', gap: 2, paddingVertical: spacing.xs },
  btn: {
    minWidth: touchTarget,
    height: touchTarget - 4,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  sep: { width: StyleSheet.hairlineWidth, height: 24, marginHorizontal: spacing.xs },
  bold: { fontWeight: '800', fontSize: 17 },
  italic: { fontStyle: 'italic', fontSize: 17, fontWeight: '600' },
  semibold: { fontWeight: '700' },
});
