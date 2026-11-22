import { audioState, expiryFrom, formatBytes } from '../../supabase/functions/_shared/audio-retention.ts';

const NOW = Date.parse('2026-11-22T06:00:00Z');

describe('audio retention', () => {
  it('expires 14 days after the transcript is done', () => {
    expect(expiryFrom(NOW)).toBe('2026-12-06T06:00:00.000Z');
  });
  it('counts down in days, then hours, then minutes', () => {
    expect(audioState({ audio_expires_at: expiryFrom(NOW) }, NOW)).toMatchObject({ kind: 'expiring', days: 14, label: '14 ngày' });
    expect(audioState({ audio_expires_at: new Date(NOW + 13.5 * 86_400_000).toISOString() }, NOW)).toMatchObject({ label: '13 ngày' });
    expect(audioState({ audio_expires_at: new Date(NOW + 5.2 * 3_600_000).toISOString() }, NOW)).toMatchObject({ days: 0, label: '5 giờ' });
    expect(audioState({ audio_expires_at: new Date(NOW + 20 * 60_000).toISOString() }, NOW).kind === 'expiring').toBe(true);
    expect(audioState({ audio_expires_at: new Date(NOW - 60_000).toISOString() }, NOW)).toMatchObject({ label: 'ít phút nữa' });
  });
  it('keeps audio until there is a transcript; deleted wins', () => {
    expect(audioState({}, NOW)).toEqual({ kind: 'kept' });
    expect(audioState({ audio_expires_at: expiryFrom(NOW), audio_deleted_at: '2026-11-22T00:00:00Z' }, NOW)).toEqual({ kind: 'deleted' });
  });
  it('formats sizes the Vietnamese way', () => {
    expect(formatBytes(512_000)).toBe('500 KB');
    expect(formatBytes(27 * 1024 ** 2)).toBe('27 MB');
    expect(formatBytes(3.4 * 1024 ** 2)).toBe('3,4 MB');
    expect(formatBytes(1.25 * 1024 ** 3)).toBe('1,25 GB');
  });
});
