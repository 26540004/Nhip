/**
 * "✦ Chia nhỏ việc này" (pure; shared by the split-task Edge Function and Jest).
 * AI proposes 2–7 concrete steps; code cleans them up: trims, drops duplicates (also of
 * existing subtasks), clamps each estimate to 10–90 minutes in 5-minute steps and, when the
 * task has an estimate, scales the steps to fit the minutes not yet covered by subtasks.
 */
import { z } from 'zod';
import { normalizeVi } from './vi-parse.ts';

export const SplitRequest = z.object({ task_id: z.string().uuid() });

export const AiSplit = z.object({
  steps: z
    .array(
      z.object({
        title: z.string().max(200),
        estimate_minutes: z.number().int().min(0).max(600).nullable().optional(),
      }),
    )
    .min(1)
    .max(12),
});
export type AiSplit = z.infer<typeof AiSplit>;

export interface SplitStep {
  title: string;
  estimate_minutes: number;
}

export interface SplitContext {
  title: string;
  description: string | null;
  estimate_minutes: number | null;
  deadline_local: string | null;
  space: 'study' | 'work';
  collection_name: string | null;
  existing_subtasks: { title: string; estimate_minutes: number | null }[];
  privacy: boolean;
}

export const MIN_STEP = 10;
export const MAX_STEP = 90;
export const MAX_STEPS = 7;

export function splitPrompt(ctx: SplitContext): { system: string; user: string } {
  const lines = [
    `Task: ${ctx.title}`,
    `Space: ${ctx.space === 'study' ? 'Học tập (coursework)' : 'Công việc (office work)'}`,
    ctx.collection_name ? `Subject/project: ${ctx.collection_name}` : null,
    ctx.estimate_minutes ? `Total estimate: ${ctx.estimate_minutes} minutes` : 'Total estimate: unknown',
    ctx.deadline_local ? `Deadline: ${ctx.deadline_local}` : null,
    // Privacy mode: only title, durations, deadlines and times are sent.
    !ctx.privacy && ctx.description ? `Details: ${ctx.description.slice(0, 1500)}` : null,
    ctx.existing_subtasks.length ? `Already planned steps (do not repeat): ${ctx.existing_subtasks.map((s) => s.title).join('; ')}` : null,
  ].filter(Boolean);
  return {
    system: [
      'You break one task of a Vietnamese working student into concrete, sequential steps. Output ONLY JSON:',
      '{"steps":[{"title":string,"estimate_minutes":number}]}',
      'Rules:',
      '- 2 to 7 steps, in the order they should be done. Each step fits one focused sitting (15–90 minutes).',
      '- Titles in Vietnamese, short imperative phrases (max 80 characters), specific to this task — no generic filler like "Bắt đầu".',
      '- If a total estimate is given, the step estimates should add up to about that total.',
      '- Never repeat steps that are already planned. Do not invent requirements that are not implied by the task.',
    ].join('\n'),
    user: lines.join('\n'),
  };
}

const roundTo5 = (n: number) => Math.round(n / 5) * 5;
const clampStep = (n: number) => Math.max(MIN_STEP, Math.min(MAX_STEP, roundTo5(n)));

export function normalizeSplit(ai: AiSplit, ctx: Pick<SplitContext, 'estimate_minutes' | 'existing_subtasks' | 'title'>): SplitStep[] {
  const seen = new Set([normalizeVi(ctx.title), ...ctx.existing_subtasks.map((s) => normalizeVi(s.title))]);
  const steps: SplitStep[] = [];
  for (const s of ai.steps) {
    const title = s.title
      .replace(/\s+/g, ' ')
      .replace(/^[-•\d.)\s]+/, '')
      .trim()
      .slice(0, 120);
    const key = normalizeVi(title);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    steps.push({ title, estimate_minutes: clampStep(s.estimate_minutes ?? 30) });
    if (steps.length === MAX_STEPS) break;
  }
  if (steps.length === 0) return steps;

  // Fit the minutes the existing subtasks don't cover yet.
  if (ctx.estimate_minutes && ctx.estimate_minutes > 0) {
    const covered = ctx.existing_subtasks.reduce((sum, s) => sum + (s.estimate_minutes ?? 0), 0);
    const target = ctx.estimate_minutes - covered;
    const total = steps.reduce((sum, s) => sum + s.estimate_minutes, 0);
    // When existing subtasks already use up the estimate, the user is adding work: keep the AI's sizes.
    if (target >= steps.length * MIN_STEP && Math.abs(total - target) > 5) {
      const scaled = steps.map((s) => clampStep((s.estimate_minutes * target) / total));
      // Put the rounding remainder on the steps that still have room.
      let diff = target - scaled.reduce((a, b) => a + b, 0);
      for (let i = 0; diff !== 0 && i < scaled.length * 20; i++) {
        const j = i % scaled.length;
        const step = diff > 0 ? 5 : -5;
        const next = scaled[j]! + step;
        if (next >= MIN_STEP && next <= MAX_STEP) {
          scaled[j] = next;
          diff -= step;
        }
        if (Math.abs(diff) < 5) break;
      }
      steps.forEach((s, i) => (s.estimate_minutes = scaled[i]!));
    }
  }
  return steps;
}
