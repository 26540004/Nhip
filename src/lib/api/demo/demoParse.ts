/**
 * Rule-based Quick Add parsing for the demo (no AI call). Splits the sentence into tasks,
 * removes date/time/duration words from titles and resolves them with the same
 * deterministic Vietnamese resolver the server uses.
 */
import { splitMinutes } from '../../../../supabase/functions/_shared/planning/greedyPlan.ts';
import {
  guessSpace,
  matchCollection,
  normalizeVi,
  parseDurationMinutes,
  resolveDeadline,
} from '../../../../supabase/functions/_shared/vi-parse.ts';
import type { ParsedTask, ParseTaskResponse } from '../types';

export interface DemoCollection {
  id: string;
  name: string;
  space: 'study' | 'work';
}

const DATE_RES: RegExp[] = [
  /\b(hom nay|toi nay|sang nay|chieu nay|trua nay|dem nay|ngay mai|ngay mot|ngay kia|sang mai|chieu mai|toi mai)\b/g,
  /\b(cuoi tuan|dau thang|cuoi thang)( (sau|toi|nay))?\b/g,
  /\b(thu (hai|ba|tu|nam|sau|bay|[2-7])|t[2-7]|chu nhat|cn)( (nay|tuan (sau|toi)))?\b/g,
  /\btuan (sau|toi)\b/g,
  /\bthang (sau|toi)\b/g,
  /\b\d{1,2}\s*[/-]\s*\d{1,2}(\s*[/-]\s*\d{2,4})?\b/g,
  /\bngay \d{1,2}( thang \d{1,2})?\b/g,
  /\b\d{1,2} ngay nua\b/g,
  /\b\d{1,2}\s*(h|g|gio|:)(\s*\d{1,2})?( ruoi)?( (sang|trua|chieu|toi|dem))?( (nay|mai))?\b/g,
  /\b\d{1,2} ruoi( (sang|trua|chieu|toi))?\b/g,
  /\b(mai|mot)\b(?! (tieng|gio|phut))/g,
];
const DURATION_RE =
  /\b(?:(?:mat|khoang|tam|trong)\s+)*(?:\d+(?:[.,]\d+)?\s*(?:tieng|phut|ph)(?:\s*ruoi)?(?:\s*\d+\s*phut)?|nua tieng|mot tieng ruoi)\b/g;
const FILLER = new Set(['truoc', 'luc', 'vao', 'mat', 'khoang', 'tam', 'han', 'trong', 'nay']);

/** Remove the words covered by `ranges` from the original (accented) text. */
function stripRanges(words: string[], norm: string[], ranges: [number, number][]): string {
  let pos = 0;
  const keep: string[] = [];
  norm.forEach((w, i) => {
    const start = pos;
    const end = pos + w.length;
    pos = end + 1;
    const covered = ranges.some(([a, b]) => start < b && a < end);
    if (!covered) keep.push(words[i]!);
  });
  // Drop dangling filler words ("trước", "mất", …) at the ends.
  while (keep.length && FILLER.has(normalizeVi(keep[keep.length - 1]!))) keep.pop();
  while (keep.length && FILLER.has(normalizeVi(keep[0]!))) keep.shift();
  return keep
    .join(' ')
    .replace(/[,;.\s]+$/, '')
    .trim();
}

export function demoParse(text: string, collections: readonly DemoCollection[], now: number, tz: string): ParseTaskResponse {
  const urlMatch = /\bhttps?:\/\/[^\s<>"']+/i.exec(text);
  const url = urlMatch ? urlMatch[0].replace(/[).,;]+$/, '') : null;
  const clean = url ? text.replace(url, ' ') : text;

  const segments = clean
    .split(/[;,\n]|\s+và\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);

  const tasks: ParsedTask[] = [];
  for (const seg of segments.length ? segments : [clean.trim()]) {
    const words = seg.split(/\s+/);
    const norm = words.map((w) => normalizeVi(w));
    const joined = norm.join(' ');
    const dateRanges: [number, number][] = [];
    for (const re of DATE_RES) for (const m of joined.matchAll(re)) dateRanges.push([m.index!, m.index! + m[0].length]);
    const durRanges: [number, number][] = [];
    let durText = '';
    for (const m of joined.matchAll(DURATION_RE)) {
      durRanges.push([m.index!, m.index! + m[0].length]);
      durText = m[0];
    }
    const dateText = dateRanges.map(([a, b]) => joined.slice(a, b)).join(' ');
    const deadline = dateText ? (resolveDeadline(dateText, now, tz)?.iso ?? null) : null;
    const estimate = durText ? parseDurationMinutes(durText) : null;
    let title = stripRanges(words, norm, [...dateRanges, ...durRanges]);
    // A clause with only time/duration words ("…, mất khoảng 3 tiếng") belongs to the previous task.
    const prev = tasks[tasks.length - 1];
    if (!title && prev) {
      if (estimate != null && prev.estimate_minutes == null) prev.estimate_minutes = estimate;
      if (deadline && !prev.deadline_at) prev.deadline_at = deadline;
      if (prev.estimate_minutes != null && prev.estimate_minutes > 120 && prev.subtasks.length === 0) {
        prev.subtasks = splitMinutes(prev.estimate_minutes).map((m, i, all) => ({
          title: `${prev.title} – phần ${i + 1}/${all.length}`,
          estimate_minutes: m,
        }));
      }
      continue;
    }
    title = title || seg;
    title = title.charAt(0).toLocaleUpperCase('vi') + title.slice(1);

    const col = matchCollection(title, collections);
    const guess = guessSpace(title);
    const space = col?.space ?? guess ?? 'work';
    const daysLeft = deadline ? (Date.parse(deadline) - now) / 86_400_000 : null;
    const priority = daysLeft != null && daysLeft <= 2 ? 1 : daysLeft != null && daysLeft > 10 ? 3 : 2;
    const reason =
      daysLeft == null
        ? 'Không có hạn'
        : daysLeft < 1
          ? 'Hạn trong hôm nay'
          : daysLeft <= 2
            ? 'Hạn rất gần'
            : `Hạn trong ${Math.ceil(daysLeft)} ngày`;
    const subtasks =
      estimate != null && estimate > 120
        ? splitMinutes(estimate).map((m, i, all) => ({ title: `${title} – phần ${i + 1}/${all.length}`, estimate_minutes: m }))
        : [];

    tasks.push({
      title,
      space,
      space_uncertain: !col && !guess,
      collection_id: col?.id ?? null,
      collection_name: col?.name ?? null,
      deadline_at: deadline,
      estimate_minutes: estimate,
      priority,
      priority_reason: reason,
      subtasks,
    });
  }
  return { tasks, url, provider: 'demo' };
}
