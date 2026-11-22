/**
 * parse-task pipeline against mocked providers: structure, fallback, schema retry, and
 * end-to-end fixtures (AI segmentation is mocked; dates/durations are resolved in code).
 */
import {
  AIError,
  type AIProvider,
  type AIRequest,
  type AIResponse,
  callWithFallback,
  generateStructured,
  SchemaError,
} from '../../supabase/functions/_shared/ai-provider.ts';
import {
  AiParseResponse,
  buildPrompt,
  extractUrl,
  finalizeParse,
  type CollectionRef,
} from '../../supabase/functions/_shared/parse-task-core.ts';

const TZ = 'Asia/Ho_Chi_Minh';
const NOW = Date.parse('2026-11-16T13:30:00+07:00');
const COLS: CollectionRef[] = [
  { id: 'c-mang', name: 'Mạng máy tính', space: 'study' },
  { id: 'c-csdl', name: 'Cơ sở dữ liệu', space: 'study' },
  { id: 'p-web', name: 'Website Kim Long', space: 'work' },
];

class FakeProvider implements AIProvider {
  readonly supportsAudio: boolean;
  calls = 0;
  constructor(
    readonly name: string,
    private readonly script: (AIResponse | AIError)[],
    readonly model = 'fake-model',
    audio = false,
  ) {
    this.supportsAudio = audio;
  }
  async generateJson(_req: AIRequest): Promise<AIResponse> {
    const next = this.script[Math.min(this.calls, this.script.length - 1)]!;
    this.calls++;
    if (next instanceof AIError) throw next;
    return next;
  }
}

const ok = (name: string, obj: unknown): AIResponse => ({ text: JSON.stringify(obj), provider: name, model: 'm' });
const noSleep = { sleep: async () => {}, baseDelayMs: 0 };

describe('AIProvider fallback', () => {
  it('Gemini 429 → retries once → falls back to Groq', async () => {
    const gemini = new FakeProvider('gemini', [new AIError('429', 429, true, 'gemini')]);
    const groq = new FakeProvider('groq', [ok('groq', { tasks: [] })]);
    const res = await callWithFallback([gemini, groq], { system: 's', user: 'u' }, noSleep);
    expect(res.provider).toBe('groq');
    expect(gemini.calls).toBe(2); // first try + 1 retry
    expect(groq.calls).toBe(1);
  });

  it('non-retryable error skips straight to the next provider', async () => {
    const gemini = new FakeProvider('gemini', [new AIError('400', 400, false, 'gemini')]);
    const groq = new FakeProvider('groq', [ok('groq', {})]);
    await callWithFallback([gemini, groq], { system: 's', user: 'u' }, noSleep);
    expect(gemini.calls).toBe(1);
  });

  it('audio requests never go to text-only providers', async () => {
    const groq = new FakeProvider('groq', [ok('groq', {})]);
    await expect(
      callWithFallback([groq], { system: 's', user: 'u', audio: { mimeType: 'audio/mp4', base64: '' } }, noSleep),
    ).rejects.toThrow('no AI provider configured');
    expect(groq.calls).toBe(0);
  });

  it('all providers failing throws the last error', async () => {
    const a = new FakeProvider('gemini', [new AIError('503', 503, true, 'gemini')]);
    const b = new FakeProvider('groq', [new AIError('500', 500, true, 'groq')]);
    await expect(callWithFallback([a, b], { system: 's', user: 'u' }, noSleep)).rejects.toMatchObject({ provider: 'groq' });
  });
});

describe('generateStructured', () => {
  const valid = {
    tasks: [
      {
        title: 'Gọi khách hàng A',
        space: 'work',
        collection_name: null,
        deadline_phrase: 'mai',
        priority: 2,
        priority_reason: 'Hạn ngày mai',
      },
    ],
  };

  it('retries once on schema failure, then succeeds', async () => {
    const p = new FakeProvider('gemini', [ok('gemini', { tasks: [{ title: '' }] }), ok('gemini', valid)]);
    const res = await generateStructured([p], AiParseResponse, { system: 's', user: 'u' }, noSleep);
    expect(res.data.tasks[0]!.title).toBe('Gọi khách hàng A');
    expect(p.calls).toBe(2);
  });

  it('accepts ```json fenced output', async () => {
    const p = new FakeProvider('gemini', [{ text: '```json\n' + JSON.stringify(valid) + '\n```', provider: 'gemini', model: 'm' }]);
    const res = await generateStructured([p], AiParseResponse, { system: 's', user: 'u' }, noSleep);
    expect(res.data.tasks).toHaveLength(1);
  });

  it('two schema failures → SchemaError (caller falls back to inbox)', async () => {
    const p = new FakeProvider('gemini', [ok('gemini', { nope: true })]);
    await expect(generateStructured([p], AiParseResponse, { system: 's', user: 'u' }, noSleep)).rejects.toBeInstanceOf(SchemaError);
  });
});

/** End-to-end fixtures: input text, what a model would return, expected final output. */
const pipelineFixtures: {
  text: string;
  ai: unknown;
  expect: Partial<{
    title: string;
    space: string;
    space_uncertain: boolean;
    collection_id: string | null;
    deadline_at: string | null;
    estimate_minutes: number | null;
    subtasks: number;
  }>[];
}[] = [
  {
    text: 'thứ 6 nộp báo cáo môn Mạng, mất khoảng 3 tiếng',
    ai: {
      tasks: [
        {
          title: 'nộp báo cáo môn Mạng',
          space: 'study',
          collection_name: 'Mạng máy tính',
          deadline_phrase: 'thứ 6',
          deadline_at: '2026-11-21T23:59:00+07:00', // model got it wrong — code fixes it
          estimate_phrase: 'khoảng 3 tiếng',
          estimate_minutes: 180,
          priority: 1,
          priority_reason: 'Hạn trong 4 ngày, khối lượng lớn',
          subtasks: [
            { title: 'Tìm tài liệu', estimate_minutes: 60 },
            { title: 'Viết nội dung', estimate_minutes: 90 },
            { title: 'Rà soát', estimate_minutes: 30 },
          ],
        },
      ],
    },
    expect: [
      {
        title: 'Nộp báo cáo môn Mạng',
        space: 'study',
        collection_id: 'c-mang',
        deadline_at: '2026-11-20T23:59:00+07:00',
        estimate_minutes: 180,
        subtasks: 3,
      },
    ],
  },
  {
    text: 'mai gọi khách hàng A, thứ 4 họp team 2h chiều',
    ai: {
      tasks: [
        { title: 'Gọi khách hàng A', space: 'work', deadline_phrase: 'mai', priority: 2, priority_reason: 'Hạn ngày mai' },
        {
          title: 'Họp team',
          space: 'work',
          deadline_phrase: 'thứ 4 2h chiều',
          estimate_minutes: 60,
          priority: 2,
          priority_reason: 'Lịch họp cố định',
        },
      ],
    },
    expect: [
      { title: 'Gọi khách hàng A', space: 'work', deadline_at: '2026-11-17T23:59:00+07:00' },
      { title: 'Họp team', space: 'work', deadline_at: '2026-11-18T14:00:00+07:00', estimate_minutes: 60 },
    ],
  },
  {
    text: 'ôn thi CSDL trước thứ 6 tuần sau, 2 tiếng',
    ai: {
      tasks: [
        {
          title: 'Ôn thi CSDL',
          space: 'study',
          collection_name: 'Cơ sở dữ liệu',
          deadline_phrase: 'trước thứ 6 tuần sau',
          estimate_phrase: '2 tiếng',
          priority: 1,
          priority_reason: 'Thi quan trọng',
          subtasks: [{ title: 'x', estimate_minutes: 60 }],
        },
      ],
    },
    expect: [{ collection_id: 'c-csdl', deadline_at: '2026-11-27T23:59:00+07:00', estimate_minutes: 120, subtasks: 0 }],
  },
  {
    text: 'sửa banner website Kim Long trước 5h chiều',
    ai: {
      tasks: [
        {
          title: 'Sửa banner website Kim Long',
          space: 'work',
          collection_name: 'Website Kim Long',
          deadline_phrase: 'trước 5h chiều',
          priority: 1,
          priority_reason: 'Hạn hôm nay',
        },
      ],
    },
    expect: [{ space: 'work', collection_id: 'p-web', deadline_at: '2026-11-16T17:00:00+07:00' }],
  },
  {
    text: 'tối nay làm bài tập mạng 45 phút',
    ai: {
      tasks: [
        {
          title: 'Làm bài tập Mạng',
          space: 'work',
          space_confident: false,
          deadline_phrase: 'tối nay',
          estimate_phrase: '45 phút',
          priority: 2,
          priority_reason: 'Hạn tối nay',
        },
      ],
    },
    // AI said work, but the subject match overrides it to study.
    expect: [
      { space: 'study', space_uncertain: false, collection_id: 'c-mang', deadline_at: '2026-11-16T22:00:00+07:00', estimate_minutes: 45 },
    ],
  },
  {
    text: 'cuối tuần dọn phòng',
    ai: {
      tasks: [
        {
          title: 'Dọn phòng',
          space: 'study',
          space_confident: false,
          deadline_phrase: 'cuối tuần',
          priority: 3,
          priority_reason: 'Không gấp',
        },
      ],
    },
    expect: [{ space_uncertain: true, collection_id: null, deadline_at: '2026-11-22T23:59:00+07:00' }],
  },
  {
    text: 'đầu tháng sau nộp hồ sơ học bổng',
    ai: {
      tasks: [
        { title: 'Nộp hồ sơ học bổng', space: 'study', deadline_phrase: 'đầu tháng sau', priority: 2, priority_reason: 'Còn hơn 2 tuần' },
      ],
    },
    expect: [{ deadline_at: '2026-12-01T23:59:00+07:00', space: 'study' }],
  },
  {
    text: 'họp với sếp về dự án',
    ai: { tasks: [{ title: 'Họp với sếp về dự án', space: 'study', deadline_phrase: null, priority: 2, priority_reason: 'Việc công ty' }] },
    // Keyword says work but the model said study → flag for the user to confirm.
    expect: [{ space: 'study', space_uncertain: true, deadline_at: null }],
  },
];

describe('parse-task pipeline fixtures', () => {
  it.each(pipelineFixtures.map((f) => [f.text, f] as const))('%s', (_label, fixture) => {
    const ai = AiParseResponse.parse(fixture.ai);
    const { url, rest } = extractUrl(fixture.text);
    const out = finalizeParse(ai, { text: rest, now: NOW, tz: TZ, collections: COLS, url, provider: 'mock' });
    expect(out.tasks).toHaveLength(fixture.expect.length);
    fixture.expect.forEach((exp, i) => {
      const got = out.tasks[i]!;
      const { subtasks, ...rest2 } = exp;
      expect(got).toMatchObject(rest2);
      if (subtasks != null) expect(got.subtasks).toHaveLength(subtasks);
    });
  });

  it('extracts a pasted URL', () => {
    expect(extractUrl('đọc bài này https://example.com/a?b=1, mai')).toEqual({
      url: 'https://example.com/a?b=1',
      rest: 'đọc bài này , mai',
    });
  });

  it('AI deadline_at is used only when no phrase and it is plausible', () => {
    const ai = AiParseResponse.parse({
      tasks: [
        { title: 'A', space: 'work', deadline_at: '2026-11-19T10:00:00+07:00', priority: 2 },
        { title: 'B', space: 'work', deadline_at: '1999-01-01T10:00:00+07:00', priority: 2 },
      ],
    });
    const out = finalizeParse(ai, { text: '', now: NOW, tz: TZ, collections: [], url: null, provider: 'mock' });
    expect(out.tasks[0]!.deadline_at).toBe('2026-11-19T10:00:00+07:00');
    expect(out.tasks[1]!.deadline_at).toBeNull();
  });

  it('a learned nickname beats the AI guess (habit profile)', () => {
    const ai = AiParseResponse.parse({ tasks: [{ title: 'Nộp bt mmt', space: 'work', collection_name: 'Website Kim Long', priority: 2 }] });
    const alias = (t: string) => (/\bmmt\b/i.test(t) ? { collection_id: 'c-mang' } : null);
    const out = finalizeParse(ai, { text: 'nộp bt mmt', now: NOW, tz: TZ, collections: COLS, url: null, provider: 'mock', alias });
    expect(out.tasks[0]).toMatchObject({ collection_id: 'c-mang', space: 'study', space_uncertain: false });
  });

  it('prompt contains the collections and current time, not secrets', () => {
    const p = buildPrompt({
      text: 'mai gọi khách',
      nowIso: '2026-11-16T13:30:00+07:00',
      weekdayVi: 'Thứ Hai',
      tz: TZ,
      collections: COLS,
      officeHoursSummary: 'T2–T6 08:00–17:00',
    });
    expect(p.user).toContain('Mạng máy tính');
    expect(p.user).toContain('2026-11-16T13:30:00+07:00');
    expect(p.system).toContain('deadline_phrase');
  });
});
