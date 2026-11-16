/** Search across tasks, notes and transcripts (Postgres FTS, accent-insensitive). */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../src/components/AppText';
import { EmptyState } from '../src/components/EmptyState';
import { QueryState } from '../src/components/QueryState';
import { vi } from '../src/i18n/vi';
import { useSearch } from '../src/lib/api/queries';
import type { SearchHit } from '../src/lib/api/types';
import { useTheme } from '../src/theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../src/theme/tokens';
import { type as typeScale } from '../src/theme/typography';

const ICON = { task: 'checkbox-outline', note: 'document-text-outline', transcript: 'mic-outline' } as const;

export default function SearchScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text), 250);
    return () => clearTimeout(t);
  }, [text]);
  const res = useSearch(q);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const openHit = (h: SearchHit) => {
    if (h.kind === 'task') router.replace({ pathname: '/task/[id]', params: { id: h.id } });
    else router.replace({ pathname: '/note/[id]', params: { id: h.kind === 'note' ? h.id : (h.owner_id ?? h.id) } });
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.bar}>
        <View style={[styles.inputWrap, { backgroundColor: colors.surface2, borderColor: focused ? colors.primary : colors.border }]}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            autoFocus
            value={text}
            onChangeText={setText}
            placeholder={vi.search.placeholder}
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.primary}
            accessibilityLabel={vi.search.placeholder}
            returnKeyType="search"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={[typeScale.body, styles.input, { color: colors.textHeading }]}
            onKeyPress={(e) => e.nativeEvent.key === 'Escape' && close()}
          />
        </View>
        <Pressable accessibilityRole="button" onPress={close} style={styles.cancel}>
          <AppText variant="body" tone="primary">
            {vi.common.cancel}
          </AppText>
        </Pressable>
      </View>
      {q.trim().length < 2 ? (
        <AppText variant="secondary" tone="muted" style={styles.hint}>
          {vi.search.hint}
        </AppText>
      ) : (
        <QueryState isLoading={res.isLoading} error={res.error} hasData={res.data != null} onRetry={() => void res.refetch()}>
          {res.data?.length === 0 ? (
            <EmptyState icon="search-outline" title={vi.search.empty} />
          ) : (
            <FlatList
              data={res.data ?? []}
              keyExtractor={(h) => `${h.kind}-${h.id}`}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${vi.search.kinds[item.kind]}: ${item.title}`}
                  onPress={() => openHit(item)}
                  style={({ pressed }) => [
                    styles.hit,
                    { backgroundColor: pressed ? colors.surface2 : colors.surface, borderColor: colors.border },
                  ]}
                >
                  <Ionicons name={ICON[item.kind]} size={18} color={colors.textMuted} />
                  <View style={styles.flex}>
                    <AppText variant="body" tone="heading" numberOfLines={1}>
                      {item.title || vi.notes.untitled}
                    </AppText>
                    {item.snippet ? (
                      <AppText variant="meta" tone="muted" numberOfLines={2}>
                        {item.snippet}
                      </AppText>
                    ) : null}
                  </View>
                  <AppText variant="meta" tone="muted">
                    {vi.search.kinds[item.kind]}
                  </AppText>
                </Pressable>
              )}
            />
          )}
        </QueryState>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.input,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
  },
  // Focus is shown on the wrapper border instead of the browser outline.
  input: { flex: 1, minHeight: touchTarget, outlineWidth: 0 },
  cancel: { minHeight: touchTarget, justifyContent: 'center' },
  hint: { paddingHorizontal: spacing.lg },
  list: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: 80 },
  hit: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.input, borderWidth: 1, padding: spacing.md },
});
