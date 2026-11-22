/**
 * Learning from Quick Add edits (pure): what did the user change after the AI's suggestion?
 * Each change becomes a correction example; a fixed subject/project may also teach a nickname
 * ("nộp bt mmt" + user picked "Mạng máy tính" → "mmt" means Mạng máy tính).
 */
import { aliasCandidate } from '../../../supabase/functions/_shared/habits-core.ts';

export interface DraftFields {
  title: string;
  space: 'study' | 'work';
  collection_id: string | null;
  deadline_at: string | null;
  estimate_minutes: number | null;
}

export interface CorrectionDraft {
  input_text: string;
  field: 'collection' | 'space' | 'deadline' | 'estimate';
  ai_value: string | null;
  user_value: string | null;
}

const fmtDeadline = (iso: string | null, tz: string) =>
  iso
    ? new Intl.DateTimeFormat('vi-VN', {
        timeZone: tz,
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(Date.parse(iso))
    : null;

export function diffCorrections(
  input: string,
  ai: DraftFields,
  saved: DraftFields,
  ctx: { collectionName: (id: string | null) => string | null; tz: string; knownShorts: readonly string[] },
): { corrections: CorrectionDraft[]; alias: { short: string; collection_id: string; meaning: string } | null } {
  const text = input.trim().slice(0, 500);
  const out: CorrectionDraft[] = [];
  const name = (id: string | null) => ctx.collectionName(id)?.slice(0, 200) ?? null;
  if (ai.collection_id !== saved.collection_id)
    out.push({ input_text: text, field: 'collection', ai_value: name(ai.collection_id), user_value: name(saved.collection_id) });
  else if (ai.space !== saved.space)
    out.push({
      input_text: text,
      field: 'space',
      ai_value: ai.space === 'study' ? 'Học tập' : 'Công việc',
      user_value: saved.space === 'study' ? 'Học tập' : 'Công việc',
    });
  if (ai.deadline_at !== saved.deadline_at)
    out.push({
      input_text: text,
      field: 'deadline',
      ai_value: fmtDeadline(ai.deadline_at, ctx.tz),
      user_value: fmtDeadline(saved.deadline_at, ctx.tz),
    });
  if (ai.estimate_minutes !== saved.estimate_minutes)
    out.push({
      input_text: text,
      field: 'estimate',
      ai_value: ai.estimate_minutes == null ? null : `${ai.estimate_minutes} phút`,
      user_value: saved.estimate_minutes == null ? null : `${saved.estimate_minutes} phút`,
    });

  let alias = null;
  const picked = saved.collection_id ? name(saved.collection_id) : null;
  if (saved.collection_id && picked && ai.collection_id !== saved.collection_id) {
    const short = aliasCandidate(text, picked);
    const known = new Set(ctx.knownShorts.map((s) => s.trim().toLowerCase()));
    if (short && !known.has(short)) alias = { short, collection_id: saved.collection_id, meaning: picked };
  }
  return { corrections: out, alias };
}
