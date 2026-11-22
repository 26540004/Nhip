import { normalizeLearn } from '../../supabase/functions/_shared/learn-style-core.ts';
import { diffCorrections } from '../features/quick-add/corrections';
import {
  aliasCandidate,
  aliasMatch,
  computeProfile,
  estimateFactor,
  type HabitTask,
  habitsPrompt,
  type VocabEntry,
  windowLabel,
} from '../../supabase/functions/_shared/habits-core.ts';

const NOW = Date.parse('2026-11-22T03:00:00Z');
const TZ = 'Asia/Ho_Chi_Minh';
let n = 0;
const task = (p: Partial<HabitTask>): HabitTask => ({
  id: `t${++n}`,
  space: 'study',
  collection_id: null,
  estimate_minutes: null,
  actual_minutes: null,
  status: 'done',
  completed_at: '2026-11-20T14:30:00Z', // 21:30 local
  ...p,
});
const labels = { study: 'Học tập', work: 'Công việc', mmt: 'Mạng máy tính' };

describe('habit profile', () => {
  it('learns that study tasks overrun, shrinking toward the prior with little data', () => {
    const few = computeProfile({ tasks: [task({ estimate_minutes: 60, actual_minutes: 120 })], labels, answers: {}, tz: TZ, now: NOW });
    const s1 = few.estimates.find((e) => e.key === 'study')!;
    expect(s1.n).toBe(1);
    expect(s1.confidence).toBe('low');
    expect(s1.ratio).toBeGreaterThan(1);
    expect(s1.ratio).toBeLessThan(1.4); // one task can't push it to 2×

    const many = computeProfile({
      tasks: Array.from({ length: 10 }, () => task({ estimate_minutes: 60, actual_minutes: 90, collection_id: 'mmt' })),
      labels,
      answers: {},
      tz: TZ,
      now: NOW,
    });
    const s2 = many.estimates.find((e) => e.key === 'study')!;
    expect(s2.confidence).toBe('high');
    expect(s2.ratio).toBeCloseTo(1.38, 1);
    expect(many.estimates.find((e) => e.key === 'mmt')).toMatchObject({ label: 'Mạng máy tính', n: 10 });
    expect(estimateFactor(many, { space: 'study', collection_id: 'mmt' })).toBeGreaterThan(1.3);
    expect(estimateFactor(many, { space: 'work', collection_id: null })).toBe(1);
    expect(estimateFactor(null, { space: 'study', collection_id: null })).toBe(1);
  });

  it('uses the self-report until there is data, and ignores absurd actuals', () => {
    const p = computeProfile({ tasks: [], labels, answers: { overrun: 'often', focus_study: ['evening'] }, tz: TZ, now: NOW });
    expect(p.estimates.find((e) => e.key === 'study')!.ratio).toBe(1.3);
    expect(p.focus).toEqual([{ space: 'study', hour: 18, share: 0, n: 0 }]);
    const wild = computeProfile({
      tasks: Array.from({ length: 8 }, () => task({ estimate_minutes: 30, actual_minutes: 3000 })),
      labels,
      answers: {},
      tz: TZ,
      now: NOW,
    });
    expect(wild.estimates.find((e) => e.key === 'study')!.ratio).toBeLessThanOrEqual(2.2);
  });

  it('finds focus windows from completion times (local time)', () => {
    const tasks = [
      ...Array.from({ length: 6 }, () => task({ completed_at: '2026-11-18T14:40:00Z' })), // 21:40 → 20:00–22:00
      ...Array.from({ length: 2 }, () => task({ completed_at: '2026-11-18T02:00:00Z' })), // 09:00
    ];
    const p = computeProfile({ tasks, labels, answers: {}, tz: TZ, now: NOW });
    expect(p.focus[0]).toMatchObject({ space: 'study', hour: 20, n: 6 });
    expect(p.focus.some((f) => f.hour === 8)).toBe(false); // 2 of 8 → below the threshold count
    expect(windowLabel(20)).toBe('20:00–22:00');
    expect(windowLabel(22)).toBe('22:00–02:00');
  });
});

describe('vocabulary', () => {
  const vocab: VocabEntry[] = [
    { id: '1', short: 'mmt', meaning: 'Mạng máy tính', collection_id: 'c-mmt', source: 'user' },
    { id: '2', short: 'bt', meaning: 'bài tập', collection_id: null, source: 'learned' },
  ];
  it('matches subject nicknames as whole words only', () => {
    expect(aliasMatch('nộp bt MMT thứ 6', vocab)?.collection_id).toBe('c-mmt');
    expect(aliasMatch('mmtx abc', vocab)).toBeNull();
  });
  it('suggests a nickname from a correction', () => {
    expect(aliasCandidate('nộp bt mmt thứ 6', 'Mạng máy tính')).toBe('mmt');
    expect(aliasCandidate('ôn csdl tối nay', 'Cơ sở dữ liệu')).toBe('csdl');
    expect(aliasCandidate('làm báo cáo', 'Mạng máy tính')).toBeNull();
  });
  it("builds a prompt summary; privacy mode drops the user's own sentences", () => {
    const ctx = {
      profile: null,
      vocab,
      corrections: [
        { input_text: 'nộp bt mmt', field: 'collection' as const, ai_value: null, user_value: 'Mạng máy tính', created_at: '' },
      ],
      collectionName: (id: string) => (id === 'c-mmt' ? 'Mạng máy tính' : null),
      privacy: false,
    };
    const p = habitsPrompt(ctx, 'parse');
    expect(p).toContain('"mmt" = Mạng máy tính (subject/project)');
    expect(p).toContain('"bt" = bài tập');
    expect(p).toContain('"nộp bt mmt" → collection should be Mạng máy tính');
    expect(habitsPrompt({ ...ctx, privacy: true }, 'parse')).not.toContain('nộp bt mmt');
    expect(habitsPrompt({ ...ctx, vocab: [], corrections: [] }, 'parse')).toBe('');
  });
});

describe('learn-style', () => {
  it('keeps only terms that occur in the notes, are new, and maps subjects', () => {
    const text = 'Tối nay làm bt MMT, nộp dl thứ 6. Họp nhóm csdl.';
    const out = normalizeLearn(
      {
        terms: [
          { short: 'bt', meaning: 'bài tập' },
          { short: 'MMT', meaning: 'Mạng máy tính', collection_name: 'mạng máy tính' },
          { short: 'xyz', meaning: 'bịa ra' },
          { short: 'dl', meaning: 'deadline' },
          { short: 'csdl', meaning: 'Cơ sở dữ liệu' },
          { short: 'bt', meaning: 'trùng' },
        ],
      },
      text,
      [{ id: 'c1', name: 'Mạng máy tính' }],
      ['DL'],
    );
    expect(out).toEqual([
      { short: 'bt', meaning: 'bài tập', collection_id: null },
      { short: 'MMT', meaning: 'Mạng máy tính', collection_id: 'c1' },
      { short: 'csdl', meaning: 'Cơ sở dữ liệu', collection_id: null },
    ]);
  });
});

describe('learning from Quick Add edits', () => {
  const ai = { title: 'Nộp bt', space: 'study' as const, collection_id: null, deadline_at: null, estimate_minutes: 30 };
  const names: Record<string, string> = { c1: 'Mạng máy tính' };
  const ctx = {
    collectionName: (id: string | null) => (id ? (names[id] ?? null) : null),
    tz: 'Asia/Ho_Chi_Minh',
    knownShorts: [] as string[],
  };
  it('records each changed field and learns the nickname', () => {
    const r = diffCorrections('nộp bt mmt thứ 6', ai, { ...ai, collection_id: 'c1', estimate_minutes: 60 }, ctx);
    expect(r.corrections.map((c) => [c.field, c.ai_value, c.user_value])).toEqual([
      ['collection', null, 'Mạng máy tính'],
      ['estimate', '30 phút', '60 phút'],
    ]);
    expect(r.alias).toEqual({ short: 'mmt', collection_id: 'c1', meaning: 'Mạng máy tính' });
    expect(diffCorrections('nộp bt mmt', ai, { ...ai, collection_id: 'c1' }, { ...ctx, knownShorts: ['MMT'] }).alias).toBeNull();
  });
  it('records nothing when the user accepted the suggestion', () => {
    expect(diffCorrections('nộp bt', ai, ai, ctx)).toEqual({ corrections: [], alias: null });
  });
});
