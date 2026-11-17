/**
 * note-ai core (pure): "✦ AI" in the note editor — summarise a note, or pull its action
 * items out as task previews. Task extraction reuses the Quick Add prompt and the
 * deterministic Vietnamese date/duration resolution from parse-task.
 */
import { z } from 'zod';
import { AiParsedTask, buildPrompt, type PromptContext } from './parse-task-core.ts';

export const NoteAiRequest = z.object({
  note_id: z.string().uuid(),
  action: z.enum(['summarize', 'extract_tasks']),
});
export type NoteAiRequest = z.infer<typeof NoteAiRequest>;

/** Notes may legitimately contain no tasks. */
export const AiExtractResponse = z.object({ tasks: z.array(AiParsedTask).max(10) });

export const NOTE_CHAR_LIMIT = 20_000;

/** Note body + transcripts of its recordings, capped. */
export function noteSource(title: string, plain: string, transcripts: readonly string[]): string {
  const parts = [title.trim(), plain.trim(), ...transcripts.map((t) => `Bản ghi âm:\n${t.trim()}`)].filter(Boolean);
  const text = parts.join('\n\n');
  return text.length > NOTE_CHAR_LIMIT ? `${text.slice(0, NOTE_CHAR_LIMIT)}\n[…]` : text;
}

export function extractPrompt(ctx: PromptContext): { system: string; user: string } {
  const base = buildPrompt(ctx);
  return {
    system: [
      base.system,
      'The input is a full note (it may include a lecture transcript), not a Quick Add line:',
      '- Extract ONLY explicit action items: homework, submissions, things to prepare, follow-ups someone must do. Ignore facts and explanations.',
      '- If there are none, return {"tasks":[]}.',
    ].join('\n'),
    user: base.user,
  };
}
