import { MAX_STEPS, normalizeSplit, splitPrompt } from '../../supabase/functions/_shared/split-task-core.ts';
import { QUICK_START_TITLE, quickStartDoc } from '../features/onboarding/quickStart';

const ctx = {
  title: 'Báo cáo môn Mạng',
  estimate_minutes: 180,
  existing_subtasks: [] as { title: string; estimate_minutes: number | null }[],
};

describe('split task', () => {
  it('cleans titles, drops duplicates of the task and existing subtasks, caps the count', () => {
    const out = normalizeSplit(
      {
        steps: [
          { title: '1. Đọc đề bài và tiêu chí chấm', estimate_minutes: 20 },
          { title: 'đọc đề bài  và tiêu chí chấm', estimate_minutes: 20 },
          { title: 'Báo cáo môn mạng', estimate_minutes: 30 },
          { title: 'Thu thập số liệu Wireshark', estimate_minutes: 60 },
          { title: '   ', estimate_minutes: 30 },
          { title: 'Vẽ sơ đồ mạng', estimate_minutes: 45 },
        ],
      },
      { ...ctx, existing_subtasks: [{ title: 'Vẽ sơ đồ mạng', estimate_minutes: 30 }] },
    );
    expect(out.map((s) => s.title)).toEqual(['Đọc đề bài và tiêu chí chấm', 'Thu thập số liệu Wireshark']);
    const many = normalizeSplit(
      { steps: Array.from({ length: 12 }, (_, i) => ({ title: `Bước ${String.fromCharCode(65 + i)}`, estimate_minutes: 30 })) },
      { ...ctx, estimate_minutes: null },
    );
    expect(many).toHaveLength(MAX_STEPS);
  });

  it('clamps each step to 10–90 min in 5-minute steps', () => {
    const out = normalizeSplit(
      {
        steps: [
          { title: 'A', estimate_minutes: 3 },
          { title: 'B', estimate_minutes: 240 },
          { title: 'C', estimate_minutes: 33 },
          { title: 'D' },
        ],
      },
      { ...ctx, estimate_minutes: null },
    );
    expect(out.map((s) => s.estimate_minutes)).toEqual([10, 90, 35, 30]);
  });

  it('scales steps to the minutes not yet covered by existing subtasks', () => {
    const out = normalizeSplit(
      {
        steps: [
          { title: 'A', estimate_minutes: 30 },
          { title: 'B', estimate_minutes: 30 },
          { title: 'C', estimate_minutes: 60 },
        ],
      },
      { ...ctx, estimate_minutes: 180, existing_subtasks: [{ title: 'Đã có', estimate_minutes: 60 }] },
    );
    expect(out.reduce((s, x) => s + x.estimate_minutes, 0)).toBe(120);
    const covered = normalizeSplit(
      {
        steps: [
          { title: 'A', estimate_minutes: 20 },
          { title: 'B', estimate_minutes: 200 },
        ],
      },
      { ...ctx, estimate_minutes: 120, existing_subtasks: [{ title: 'X', estimate_minutes: 120 }] },
    );
    expect(covered.map((s) => s.estimate_minutes)).toEqual([20, 90]);
    const big = normalizeSplit(
      {
        steps: [
          { title: 'A', estimate_minutes: 30 },
          { title: 'B', estimate_minutes: 30 },
        ],
      },
      { ...ctx, estimate_minutes: 300 },
    );
    expect(big.every((s) => s.estimate_minutes <= 90)).toBe(true);
  });

  it('privacy mode never sends the description', () => {
    const base = {
      title: 'T',
      description: 'bí mật: mật khẩu wifi',
      estimate_minutes: 60,
      deadline_local: null,
      space: 'work' as const,
      collection_name: null,
      existing_subtasks: [],
    };
    expect(splitPrompt({ ...base, privacy: false }).user).toContain('bí mật');
    expect(splitPrompt({ ...base, privacy: true }).user).not.toContain('bí mật');
  });
});

describe('quick start note', () => {
  it('is a valid document with a checklist to try', () => {
    const { doc, plain } = quickStartDoc();
    expect(QUICK_START_TITLE).toBe('Hướng dẫn nhanh');
    expect(new Set(doc.blocks.map((b) => b.id)).size).toBe(doc.blocks.length);
    expect(doc.blocks.filter((b) => b.type === 'check')).toHaveLength(3);
    expect(plain).toContain('[ ] Thêm việc đầu tiên bằng nút ＋');
  });
});
