/**
 * Transcription + summary core (pure; shared by transcribe-audio, note-ai and Jest).
 *
 * A recording is split into ~10-minute segments. Each segment is transcribed on its own
 * (sequentially, one at a time per recording): Gemini audio first, Groq Whisper as the
 * fallback. Timestamps are made absolute with the segment's start offset. When every
 * segment is done, the transcript is joined and summarised into
 *   { main_points[], key_terms[{term, explanation}], homework[{title, deadline_hint}] }.
 * Content is never logged.
 */
import { z } from 'zod';
import { AIError, type AIProvider, type CallOptions, generateStructured } from './ai-provider.ts';

export interface TranscriptLine {
  /** Seconds from the start of the whole recording. */
  t: number;
  text: string;
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** "03:15" | "1:02:03" | "75" | 75 → seconds; null when unparseable. */
export function parseClock(v: string | number | null | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/^\[|\]$/g, '');
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})(?:[.,]\d+)?$/.exec(s);
  if (!m) return null;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (sec >= 60) return null;
  return h * 3600 + min * 60 + sec;
}

export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

// ---------------------------------------------------------------------------
// Segment transcription
// ---------------------------------------------------------------------------

export const AiTranscript = z.object({
  lines: z
    .array(
      z.object({
        start: z
          .union([z.string().max(16), z.number()])
          .nullable()
          .optional(),
        text: z.string().max(4000),
      }),
    )
    .max(2000),
});

export function transcriptPrompt(durationSec: number): { system: string; user: string } {
  return {
    system: [
      'You transcribe Vietnamese lecture and meeting recordings for a student. Output ONLY JSON:',
      '{"lines":[{"start":"MM:SS","text":string}]}',
      'Rules:',
      '- Verbatim Vietnamese with correct diacritics. Keep English technical terms, code, names and numbers exactly as spoken.',
      '- One line = 1–3 sentences of one speaker. "start" is the time the line begins, relative to the start of THIS clip.',
      '- Do not summarise, translate, correct or add anything. Skip silence, music and filler-only noise.',
      '- If there is no intelligible speech, return {"lines":[]}.',
    ].join('\n'),
    user: `Transcribe this clip (about ${Math.round(durationSec / 60) || 1} minutes).`,
  };
}

/** Normalise model lines: absolute times, monotonic, empty lines dropped, clamped to the clip. */
export function toAbsoluteLines(
  lines: readonly { start?: string | number | null; text: string }[],
  startOffsetSec: number,
  durationSec: number,
): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  let last = 0;
  for (const l of lines) {
    const text = l.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    let rel = parseClock(l.start ?? null);
    if (rel == null || rel < last) rel = last; // missing or going backwards → keep order
    if (durationSec > 0 && rel > durationSec) rel = durationSec;
    last = rel;
    out.push({ t: Math.round((startOffsetSec + rel) * 10) / 10, text });
  }
  return out;
}

/** Groq Whisper (OpenAI-compatible /audio/transcriptions). */
export class WhisperTranscriber {
  readonly name = 'groq-whisper';
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly baseUrl = 'https://api.groq.com',
  ) {}

  async transcribe(audio: Uint8Array, mime: string, signal: AbortSignal): Promise<{ start: number; text: string }[]> {
    const form = new FormData();
    const ext = mime.includes('webm') ? 'webm' : mime.includes('mpeg') ? 'mp3' : mime.includes('wav') ? 'wav' : 'm4a';
    form.append('file', new Blob([audio as BlobPart], { type: mime }), `segment.${ext}`);
    form.append('model', this.model);
    form.append('language', 'vi');
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    const res = await this.fetchFn(`${this.baseUrl}/openai/v1/audio/transcriptions`, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new AIError(`whisper HTTP ${res.status}`, res.status, res.status === 429 || res.status >= 500, this.name);
    const data = (await res.json()) as { segments?: { start?: number; text?: string }[]; text?: string };
    if (data.segments?.length) return data.segments.map((s) => ({ start: s.start ?? 0, text: s.text ?? '' }));
    return data.text ? [{ start: 0, text: data.text }] : [];
  }
}

export interface SegmentAudio {
  bytes: Uint8Array;
  mime: string;
  startOffsetSec: number;
  durationSec: number;
}

export interface TranscribeDeps {
  providers: readonly AIProvider[];
  whisper: WhisperTranscriber | null;
  opts?: CallOptions;
}

/**
 * Transcribe one segment. Gemini (audio-capable providers) first; Whisper as fallback.
 * WebM (web recordings) goes to Whisper first, since it is not a documented Gemini format.
 */
export async function transcribeSegment(seg: SegmentAudio, deps: TranscribeDeps): Promise<{ lines: TranscriptLine[]; provider: string }> {
  const audioProviders = deps.providers.filter((p) => p.supportsAudio);
  const viaGemini = async () => {
    const prompt = transcriptPrompt(seg.durationSec);
    const res = await generateStructured(
      audioProviders,
      AiTranscript,
      {
        ...prompt,
        audio: { mimeType: seg.mime === 'audio/m4a' ? 'audio/mp4' : seg.mime, base64: bytesToBase64(seg.bytes) },
        maxOutputTokens: 16_384,
        temperature: 0,
      },
      { timeoutMs: 120_000, retries: 1, ...deps.opts },
    );
    return { lines: toAbsoluteLines(res.data.lines, seg.startOffsetSec, seg.durationSec), provider: res.provider };
  };
  const viaWhisper = async () => {
    const w = deps.whisper!;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const lines = await w.transcribe(seg.bytes, seg.mime, controller.signal);
      return { lines: toAbsoluteLines(lines, seg.startOffsetSec, seg.durationSec), provider: w.name };
    } catch (e) {
      if (e instanceof AIError) throw e;
      throw new AIError(controller.signal.aborted ? 'whisper timeout' : 'whisper network error', null, true, w.name);
    } finally {
      clearTimeout(timer);
    }
  };

  const order: (() => Promise<{ lines: TranscriptLine[]; provider: string }>)[] = [];
  const webm = seg.mime.includes('webm');
  if (webm && deps.whisper) order.push(viaWhisper);
  if (audioProviders.length) order.push(viaGemini);
  if (!webm && deps.whisper) order.push(viaWhisper);
  if (order.length === 0) throw new AIError('no speech-to-text provider configured', null, false, 'none');

  let lastError: unknown = null;
  for (const attempt of order) {
    try {
      return await attempt();
    } catch (e) {
      lastError = e;
      deps.opts?.log?.({
        event: 'stt_error',
        status: e instanceof AIError ? e.status : null,
        kind: e instanceof Error ? e.name : 'unknown',
      });
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Retry policy and completion
// ---------------------------------------------------------------------------

export const MAX_SEGMENT_ATTEMPTS = 3;

/**
 * What to do with a segment after a failed attempt (attempts already counts this one).
 * Rate limits wait longer and do not use up an attempt.
 */
export function retryDecision(
  attempts: number,
  error: unknown,
): { status: 'pending' | 'failed'; delaySec: number; refundAttempt: boolean; reason: string } {
  const status = error instanceof AIError ? error.status : null;
  if (status === 429) {
    return { status: 'pending', delaySec: Math.min(60 * 2 ** Math.min(attempts, 4), 900), refundAttempt: true, reason: 'rate_limited' };
  }
  const retryable = error instanceof AIError ? error.retryable : error instanceof Error && error.name === 'SchemaError';
  const reason =
    error instanceof AIError ? (error.status ? `http_${error.status}` : 'network') : error instanceof Error ? error.name : 'unknown';
  if (!retryable || attempts >= MAX_SEGMENT_ATTEMPTS) return { status: 'failed', delaySec: 0, refundAttempt: false, reason };
  return { status: 'pending', delaySec: 30 * 4 ** (attempts - 1), refundAttempt: false, reason };
}

export interface SegmentState {
  seq: number;
  uploaded: boolean;
  transcript_status: 'none' | 'pending' | 'processing' | 'done' | 'failed';
  transcript_json: TranscriptLine[] | null;
  start_offset_sec: number | string;
}

export interface RecordingMeta {
  /** 'recording' while the phone is still recording, 'done' after "Dừng & lưu". */
  recording?: 'recording' | 'done';
  segment_count?: number;
}

export function progressOf(meta: RecordingMeta, segments: readonly SegmentState[]) {
  const total = Math.max(meta.segment_count ?? 0, segments.length);
  const done = segments.filter((s) => s.transcript_status === 'done').length;
  const failed = segments.filter((s) => s.transcript_status === 'failed').length;
  const open = segments.filter(
    (s) => s.transcript_status === 'pending' || s.transcript_status === 'processing' || s.transcript_status === 'none',
  ).length;
  const complete = meta.recording === 'done' && segments.length >= (meta.segment_count ?? 0) && segments.length > 0 && open === 0;
  return { total, done, failed, complete };
}

export function joinTranscript(segments: readonly SegmentState[]): { lines: TranscriptLine[]; text: string } {
  const lines = [...segments]
    .sort((a, b) => a.seq - b.seq)
    .flatMap((s) => (s.transcript_status === 'done' ? (s.transcript_json ?? []) : []));
  return { lines, text: lines.map((l) => `[${formatClock(l.t)}] ${l.text}`).join('\n') };
}

// ---------------------------------------------------------------------------
// Summary (recordings and notes share one shape)
// ---------------------------------------------------------------------------

export const Summary = z.object({
  main_points: z.array(z.string().trim().min(1).max(500)).max(12),
  key_terms: z
    .array(z.object({ term: z.string().trim().min(1).max(120), explanation: z.string().trim().max(500) }))
    .max(15)
    .default([]),
  homework: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        deadline_hint: z
          .string()
          .trim()
          .max(120)
          .nullable()
          .optional()
          .transform((v) => (v ? v : null)),
      }),
    )
    .max(10)
    .default([]),
});
export type Summary = z.infer<typeof Summary>;

const SUMMARY_CHAR_LIMIT = 120_000;

export function summaryPrompt(kind: 'recording' | 'note', title: string, body: string): { system: string; user: string } {
  const clipped = body.length > SUMMARY_CHAR_LIMIT ? `${body.slice(0, SUMMARY_CHAR_LIMIT)}\n[…]` : body;
  return {
    system: [
      `You summarise a Vietnamese ${kind === 'recording' ? 'lecture or meeting transcript' : 'study or work note'} for a busy working student. Output ONLY JSON:`,
      '{"main_points":[string],"key_terms":[{"term":string,"explanation":string}],"homework":[{"title":string,"deadline_hint":string|null}]}',
      'Rules (all text in Vietnamese):',
      '- main_points: 3–8 short bullets with the essential ideas, in order. Fewer if the content is short.',
      '- key_terms: important terms/concepts that appear in the content, each with a 1-sentence explanation based on the content. Max 10.',
      '- homework: only things the speaker/author explicitly asked to do (bài tập, nộp bài, đọc chương, chuẩn bị, việc cần làm). Short imperative titles.',
      '  deadline_hint: copy the exact deadline words used ("thứ 6 tuần sau", "trước buổi sau"), or null. Never invent homework or deadlines.',
      '- Use only the content below. Do not add outside facts.',
    ].join('\n'),
    user: `Title: ${title || '(không có)'}\n\nContent:\n${clipped}`,
  };
}

export async function summarize(
  providers: readonly AIProvider[],
  kind: 'recording' | 'note',
  title: string,
  body: string,
  opts: CallOptions = {},
): Promise<{ summary: Summary; provider: string }> {
  const res = await generateStructured(
    providers,
    Summary,
    { ...summaryPrompt(kind, title, body), maxOutputTokens: 4096 },
    { timeoutMs: 60_000, ...opts },
  );
  return { summary: res.data, provider: res.provider };
}
