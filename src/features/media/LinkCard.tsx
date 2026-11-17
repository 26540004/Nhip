/**
 * A link attachment as a card (title, description, site, image). Missing previews are fetched
 * once through the link-preview function and saved on the attachment. Opens in the in-app
 * browser (expo-web-browser).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { vi } from '../../i18n/vi';
import { linkPreview } from '../../lib/api/functions';
import { useUpdateAttachment } from '../../lib/api/mutations';
import type { Attachment, LinkMeta } from '../../lib/api/types';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing } from '../../theme/tokens';

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function LinkCard({ attachment, onLongPress }: { attachment: Attachment; onLongPress?: () => void }) {
  const { colors } = useTheme();
  const meta = attachment.meta_json as LinkMeta;
  const update = useUpdateAttachment(attachment.owner_id);
  const asked = useRef(false);
  const [imgOk, setImgOk] = useState(true);
  const url = attachment.url ?? '';
  const site = meta.site_name || hostOf(url);
  const loading = !meta.preview;

  useEffect(() => {
    if (meta.preview || asked.current || !url) return;
    asked.current = true;
    linkPreview(url)
      .then((p) =>
        update.mutate({
          id: attachment.id,
          patch: {
            title: p.title ?? attachment.title,
            meta_json: { description: p.description, image: p.image, site_name: p.site_name, preview: 'ok' },
          },
        }),
      )
      .catch((e: { code?: string }) => {
        // Offline: try again next time the card is shown. Otherwise remember the failure.
        if (e?.code === 'offline') asked.current = false;
        else update.mutate({ id: attachment.id, patch: { meta_json: { ...meta, preview: 'failed' } } });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id, meta.preview, url]);

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${attachment.title ?? url}. ${vi.media.linkOpen(site)}`}
      onPress={() => void WebBrowser.openBrowserAsync(url)}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
    >
      {meta.image && imgOk ? (
        <Image source={{ uri: meta.image }} style={styles.image} resizeMode="cover" onError={() => setImgOk(false)} />
      ) : (
        <View style={[styles.image, styles.iconBox, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="link" size={22} color={colors.primary} />
        </View>
      )}
      <View style={styles.text}>
        <AppText variant="body" tone="heading" numberOfLines={2}>
          {attachment.title || url}
        </AppText>
        {meta.description ? (
          <AppText variant="secondary" tone="muted" numberOfLines={2}>
            {meta.description}
          </AppText>
        ) : loading ? (
          <AppText variant="secondary" tone="muted">
            {vi.media.linkLoading}
          </AppText>
        ) : null}
        <AppText variant="meta" tone="primary" numberOfLines={1}>
          {site}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', minHeight: 84 },
  image: { width: 96, alignSelf: 'stretch', minHeight: 84 },
  iconBox: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, padding: spacing.md, gap: 2, justifyContent: 'center' },
});
