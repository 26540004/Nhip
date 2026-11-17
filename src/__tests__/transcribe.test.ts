import { AIError, type AIProvider, SchemaError } from '../../supabase/functions/_shared/ai-provider.ts';
import {
  formatClock,
  joinTranscript,
  parseClock,
  progressOf,
  retryDecision,
  type SegmentState,
  summarize,
  toAbsoluteLines,
  transcribeSegment,
  WhisperTranscriber,
} from '../../supabase/functions/_shared/transcribe-core.ts';

const fakeProvider = (name: string, supportsAudio: boolean, respond: () => string | Error): AIProvider & { calls: number } => {
  const p = {
    name,
    model: 'm',
    supportsAudio,
    calls: 0,
    async generateJson() {
      p.calls++;
      const r = respond();
      if (r instanceof Error) throw r;
      return { text: r, provider: name, model: 'm' };
    },
  };
  return p;
};

const seg = { bytes: new Uint8Array([1, 2, 3]), mime: 'audio/mp4', startOffsetSec: 600, durationSec: 600 };
const noSleep = { sleep: async () => undefined, baseDelayMs: 0 };

describe('clock helpers', () => {
  it('parses and formats timestamps', () => {
    expect(parseClock('03:15')).toBe(195);
    expect(parseClock('1:02:03')).toBe(3723);
    expect(parseClock('[00:07]')).toBe(7);
    expect(parseClock(12.5)).toBe(12.5);
    expect(parseClock('7:61')).toBeNull();
    expect(parseClock('abc')).toBeNull();
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatClock(65)).toBe('01:05');
  });

  it('makes lines absolute, monotonic and clamped; drops empty lines', () => {
    expect(
      toAbsoluteLines(
        [
          { start: '00:05', text: ' Hôm nay  học TCP ' },
          { start: null, text: 'tiếp theo' },
          { start: '00:02', text: 'lùi giờ' },
          { start: '99:00', text: 'quá dài' },
          { start: '01:00', text: '   ' },
        ],
        600,
        300,
      ),
    ).toEqual([
      { t: 605, text: 'Hôm nay học TCP' },
      { t: 605, text: 'tiếp theo' },
      { t: 605, text: 'lùi giờ' },
      { t: 900, text: 'quá dài' },
    ]);
  });
});

describe('segment transcription', () => {
  it('uses Gemini audio and offsets timestamps by the segment start', async () => {
    const gemini = fakeProvider('gemini', true, () => JSON.stringify({ lines: [{ start: '00:10', text: 'Bắt tay ba bước' }] }));
    const text = fakeProvider('groq', false, () => '{}');
    const out = await transcribeSegment(seg, { providers: [gemini, text], whisper: null, opts: noSleep });
    expect(out).toEqual({ provider: 'gemini', lines: [{ t: 610, text: 'Bắt tay ba bước' }] });
    expect(text.calls).toBe(0); // text-only providers never get audio
  });

  it('falls back to Whisper when Gemini fails, and sends WebM to Whisper first', async () => {
    const gemini = fakeProvider('gemini', true, () => new AIError('down', 503, true, 'gemini'));
    const fetchFn = jest.fn(async () => new Response(JSON.stringify({ segments: [{ start: 1.5, text: ' xin chào ' }] }), { status: 200 }));
    const whisper = new WhisperTranscriber('k', 'whisper-model', fetchFn as never, 'https://stt.test');
    const out = await transcribeSegment(seg, { providers: [gemini], whisper, opts: noSleep });
    expect(out).toEqual({ provider: 'groq-whisper', lines: [{ t: 601.5, text: 'xin chào' }] });
    expect(gemini.calls).toBe(2); // one retry on 503, then fallback
    expect((fetchFn.mock.calls[0] as unknown[])[0]).toBe('https://stt.test/openai/v1/audio/transcriptions');

    gemini.calls = 0;
    const webm = await transcribeSegment({ ...seg, mime: 'audio/webm' }, { providers: [gemini], whisper, opts: noSleep });
    expect(webm.provider).toBe('groq-whisper');
    expect(gemini.calls).toBe(0);
  });

  it('errors clearly when nothing can transcribe', async () => {
    await expect(transcribeSegment(seg, { providers: [fakeProvider('groq', false, () => '{}')], whisper: null })).rejects.toMatchObject({
      retryable: false,
    });
  });
});

describe('retry policy and completion', () => {
  it('backs off, refunds attempts on rate limits and gives up after 3 attempts', () => {
    expect(retryDecision(1, new AIError('x', 429, true, 'gemini'))).toMatchObject({
      status: 'pending',
      refundAttempt: true,
      delaySec: 120,
    });
    expect(retryDecision(1, new AIError('x', 503, true, 'gemini'))).toMatchObject({ status: 'pending', delaySec: 30 });
    expect(retryDecision(2, new SchemaError('bad'))).toMatchObject({ status: 'pending', delaySec: 120 });
    expect(retryDecision(3, new AIError('x', 500, true, 'gemini'))).toMatchObject({ status: 'failed' });
    expect(retryDecision(1, new AIError('x', 400, false, 'gemini'))).toMatchObject({ status: 'failed', reason: 'http_400' });
  });

  const s = (seq: number, status: SegmentState['transcript_status'], lines: SegmentState['transcript_json'] = null): SegmentState => ({
    seq,
    uploaded: true,
    transcript_status: status,
    transcript_json: lines,
    start_offset_sec: seq * 600,
  });

  it('is complete only when recording stopped, all segments exist and none are open', () => {
    const segs = [s(0, 'done'), s(1, 'processing')];
    expect(progressOf({ recording: 'recording' }, segs)).toMatchObject({ total: 2, done: 1, complete: false });
    expect(progressOf({ recording: 'done', segment_count: 3 }, [s(0, 'done'), s(1, 'done')])).toMatchObject({ total: 3, complete: false });
    expect(progressOf({ recording: 'done', segment_count: 2 }, [s(0, 'done'), s(1, 'failed')])).toMatchObject({
      failed: 1,
      complete: true,
    });
  });

  it('joins transcripts in order with clock labels', () => {
    const out = joinTranscript([s(1, 'done', [{ t: 601, text: 'B' }]), s(0, 'done', [{ t: 3, text: 'A' }]), s(2, 'failed')]);
    expect(out.text).toBe('[00:03] A\n[10:01] B');
  });

  it('summarises into the shared shape, normalising empty deadline hints', async () => {
    const p = fakeProvider('gemini', true, () =>
      JSON.stringify({
        main_points: ['TCP tin cậy'],
        key_terms: [{ term: 'SYN', explanation: 'gói mở kết nối' }],
        homework: [{ title: 'Làm bài 3', deadline_hint: '' }],
      }),
    );
    const { summary } = await summarize([p], 'recording', 'Mạng máy tính', '[00:01] ...');
    expect(summary.homework).toEqual([{ title: 'Làm bài 3', deadline_hint: null }]);
  });
});
