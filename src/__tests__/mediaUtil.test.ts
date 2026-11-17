import { extractPrompt, noteSource, NOTE_CHAR_LIMIT } from '../../supabase/functions/_shared/note-ai-core.ts';
import { fitWithin, normalizeUrl } from '../lib/media/util';

describe('media helpers', () => {
  it('fits images within 1920 px keeping the aspect ratio', () => {
    expect(fitWithin(4032, 3024, 1920)).toEqual({ width: 1920 });
    expect(fitWithin(3024, 4032, 1920)).toEqual({ height: 1920 });
    expect(fitWithin(1200, 800, 1920)).toBeNull();
  });

  it('normalises pasted links and rejects other schemes', () => {
    expect(normalizeUrl('  courses.uit.edu.vn/course/view.php?id=7 ')).toBe('https://courses.uit.edu.vn/course/view.php?id=7');
    expect(normalizeUrl('http://example.com')).toBe('http://example.com/');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('ghi chú')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });
});

describe('note AI prompt input', () => {
  it('joins note text with recording transcripts and caps the size', () => {
    const src = noteSource('TCP', 'Bắt tay ba bước', ['[00:01] xin chào']);
    expect(src).toBe('TCP\n\nBắt tay ba bước\n\nBản ghi âm:\n[00:01] xin chào');
    expect(noteSource('', 'x'.repeat(NOTE_CHAR_LIMIT + 50), []).length).toBeLessThan(NOTE_CHAR_LIMIT + 10);
  });

  it('asks only for explicit action items and allows none', () => {
    const p = extractPrompt({
      text: 'n',
      nowIso: '2026-11-17T09:00:00+07:00',
      weekdayVi: 'Thứ Ba',
      tz: 'Asia/Ho_Chi_Minh',
      collections: [],
      officeHoursSummary: '-',
    });
    expect(p.system).toContain('{"tasks":[]}');
    expect(p.user).toContain('Input:');
  });
});
