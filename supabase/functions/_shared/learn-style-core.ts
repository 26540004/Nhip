/**
 * "Nhập ghi chú cũ" (pure; shared by the learn-style Edge Function and Jest).
 * The user pastes old notes; AI lists the abbreviations and subject/project nicknames it
 * sees. Code cleans the list (dedupe, drop known ones, map to real subjects/projects).
 * Nothing is saved here: the app shows the list and the user ticks what to keep.
 */
import { z } from 'zod';
import { normalizeVi } from './vi-parse.ts';

export const LearnRequest = z.object({ text: z.string().min(20).max(20_000) });

export const AiLearn = z.object({
  terms: z
    .array(
      z.object({
        short: z.string().max(60),
        meaning: z.string().max(200),
        collection_name: z.string().max(200).nullable().optional(),
      }),
    )
    .max(60),
});
export type AiLearn = z.infer<typeof AiLearn>;

export interface LearnedTerm {
  short: string;
  meaning: string;
  collection_id: string | null;
}

export function learnPrompt(text: string, collections: readonly { name: string }[]): { system: string; user: string } {
  const system = [
    'You read notes written by a Vietnamese student who also works, to learn how they write. Output ONLY JSON:',
    '{"terms": [{"short": string, "meaning": string, "collection_name": string|null}]}',
    '- List abbreviations, shorthand and nicknames the person ACTUALLY uses in the notes (e.g. "bt" = "bài tập", "mmt" = "Mạng máy tính", "dl" = "deadline").',
    '- If a term is a nickname for one of the given subjects/projects, set collection_name to that exact name; else null.',
    '- meaning: short Vietnamese explanation. Skip ordinary words, names of people, and anything you are unsure about.',
    '- At most 40 terms, most frequent first. Never invent terms that are not in the notes.',
  ].join('\n');
  return { system, user: JSON.stringify({ subjects_and_projects: collections.map((c) => c.name), notes: text.slice(0, 20_000) }) };
}

export function normalizeLearn(
  ai: AiLearn,
  text: string,
  collections: readonly { id: string; name: string }[],
  known: readonly string[],
): LearnedTerm[] {
  const hay = ` ${normalizeVi(text).replace(/[^a-z0-9]+/g, ' ')} `;
  const seen = new Set(known.map((k) => normalizeVi(k).trim()));
  const out: LearnedTerm[] = [];
  for (const t of ai.terms) {
    const short = t.short.trim().replace(/\s+/g, ' ');
    const meaning = t.meaning.trim().replace(/\s+/g, ' ');
    const key = normalizeVi(short).trim();
    const plain = key.replace(/[^a-z0-9]+/g, ' ').trim();
    if (!short || !meaning || short.length > 40 || meaning.length > 120 || seen.has(key)) continue;
    // Must really occur in the notes (as a word), and actually be shorter than its meaning.
    if (!plain || !hay.includes(` ${plain} `) || normalizeVi(meaning) === key) continue;
    const col = t.collection_name ? collections.find((c) => normalizeVi(c.name) === normalizeVi(t.collection_name!)) : undefined;
    seen.add(key);
    out.push({ short, meaning, collection_id: col?.id ?? null });
    if (out.length >= 40) break;
  }
  return out;
}
