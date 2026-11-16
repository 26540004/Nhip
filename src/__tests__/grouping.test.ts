import type { Task } from '../lib/api/types';
import { filterTasks, groupOf, groupTasks, subtasksOf, unscheduledForToday } from '../lib/tasks/grouping';

const NOW = Date.parse('2026-11-18T10:00:00+07:00'); // Wednesday

let n = 0;
function t(p: Partial<Task>): Task {
  n++;
  return {
    id: p.id ?? `t${n}`,
    user_id: 'u',
    space: 'work',
    collection_id: null,
    parent_task_id: null,
    title: `T${n}`,
    description: null,
    deadline_at: null,
    estimate_minutes: null,
    priority: 2,
    priority_reason: null,
    status: 'todo',
    source: 'form',
    source_note_id: null,
    needs_parse: false,
    sort_order: 0,
    completed_at: null,
    actual_minutes: null,
    created_at: `2026-11-01T00:00:0${n % 10}Z`,
    updated_at: '2026-11-01T00:00:00Z',
    ...p,
  };
}

describe('task grouping', () => {
  it.each([
    ['2026-11-18T09:00:00+07:00', 'overdue'],
    ['2026-11-18T23:59:00+07:00', 'today'],
    ['2026-11-19T08:00:00+07:00', 'week'],
    ['2026-11-22T23:59:00+07:00', 'week'], // Sunday is still this week
    ['2026-11-23T00:00:00+07:00', 'later'], // next Monday
  ])('%s → %s', (deadline, group) => {
    expect(groupOf({ status: 'todo', deadline_at: deadline }, NOW)).toBe(group);
  });

  it('no deadline, done, dropped', () => {
    expect(groupOf({ status: 'todo', deadline_at: null }, NOW)).toBe('noDeadline');
    expect(groupOf({ status: 'done', deadline_at: '2026-11-01T00:00:00Z' }, NOW)).toBe('done');
    expect(groupOf({ status: 'dropped', deadline_at: null }, NOW)).toBeNull();
  });

  it('on Sunday, "this week" ends at midnight', () => {
    const sunday = Date.parse('2026-11-22T10:00:00+07:00');
    expect(groupOf({ status: 'todo', deadline_at: '2026-11-23T09:00:00+07:00' }, sunday)).toBe('later');
  });

  it('groups in spec order, sorted by deadline then priority; priority sort option', () => {
    const tasks = [
      t({ id: 'a', deadline_at: '2026-11-20T10:00:00+07:00', priority: 3 }),
      t({ id: 'b', deadline_at: '2026-11-21T10:00:00+07:00', priority: 1 }),
      t({ id: 'c', deadline_at: '2026-11-17T10:00:00+07:00' }),
      t({ id: 'd', status: 'done', completed_at: '2026-11-18T01:00:00Z' }),
      t({ id: 'e' }),
    ];
    const g = groupTasks(tasks, NOW);
    expect(g.map((x) => x.key)).toEqual(['overdue', 'week', 'noDeadline', 'done']);
    expect(g[1]!.tasks.map((x) => x.id)).toEqual(['a', 'b']);
    expect(groupTasks(tasks, NOW, { sort: 'priority' })[1]!.tasks.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('filters by space, collection, priority and hides subtasks', () => {
    const tasks = [
      t({ id: 's', space: 'study', collection_id: 'c1', priority: 1 }),
      t({ id: 'w', space: 'work' }),
      t({ id: 'sub', space: 'study', parent_task_id: 's' }),
    ];
    expect(filterTasks(tasks, { space: 'study' }).map((x) => x.id)).toEqual(['s']);
    expect(filterTasks(tasks, { collectionId: 'c1' }).map((x) => x.id)).toEqual(['s']);
    expect(filterTasks(tasks, { priority: 2 }).map((x) => x.id)).toEqual(['w']);
    expect(subtasksOf(tasks, 's').map((x) => x.id)).toEqual(['sub']);
  });

  it('unscheduled for today = overdue/today without blocks', () => {
    const tasks = [
      t({ id: 'od', deadline_at: '2026-11-17T10:00:00+07:00' }),
      t({ id: 'td', deadline_at: '2026-11-18T20:00:00+07:00' }),
      t({ id: 'tdBlocked', deadline_at: '2026-11-18T20:00:00+07:00' }),
      t({ id: 'later', deadline_at: '2026-11-30T20:00:00+07:00' }),
    ];
    expect(unscheduledForToday(tasks, new Set(['tdBlocked']), NOW).map((x) => x.id)).toEqual(['od', 'td']);
  });
});
