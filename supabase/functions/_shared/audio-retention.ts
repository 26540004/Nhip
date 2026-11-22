/** Audio retention (pure; shared by transcribe-audio, the app and Jest). */
export const AUDIO_KEEP_DAYS = 14;

export function expiryFrom(doneAt: number): string {
  return new Date(doneAt + AUDIO_KEEP_DAYS * 86_400_000).toISOString();
}

export type AudioState =
  | { kind: 'kept' } // no transcript yet (or it failed): audio stays
  | { kind: 'expiring'; days: number; hours: number; label: string }
  | { kind: 'deleted' };

/** "Tự xoá sau 13 ngày" · "sau 5 giờ" · "trong ít phút nữa". */
export function audioState(a: { audio_expires_at?: string | null; audio_deleted_at?: string | null }, now: number): AudioState {
  if (a.audio_deleted_at) return { kind: 'deleted' };
  if (!a.audio_expires_at) return { kind: 'kept' };
  const ms = Math.max(0, Date.parse(a.audio_expires_at) - now);
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  const label = days >= 1 ? `${days} ngày` : hours >= 1 ? `${hours} giờ` : 'ít phút nữa';
  return { kind: 'expiring', days, hours, label };
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0).replace('.', ',')} MB`;
  return `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} GB`;
}
