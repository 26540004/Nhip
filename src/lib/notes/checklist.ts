/**
 * Plain-text checklist lines in notes (until the rich editor lands in Phase 5):
 *   "[ ] việc chưa xong"  "- [ ] …"  "[x] đã xong"  "[→] đã chuyển thành việc"
 */
export interface ChecklistLine {
  index: number;
  text: string;
  checked: boolean;
  converted: boolean;
}

const RE = /^(\s*(?:[-*]\s+)?)\[( |x|X|→)\]\s*(.*)$/;

export function parseChecklist(body: string): ChecklistLine[] {
  const out: ChecklistLine[] = [];
  body.split('\n').forEach((line, index) => {
    const m = RE.exec(line);
    if (!m || !m[3]!.trim()) return;
    out.push({ index, text: m[3]!.trim(), checked: m[2] === 'x' || m[2] === 'X', converted: m[2] === '→' });
  });
  return out;
}

function setMark(body: string, index: number, mark: ' ' | 'x' | '→'): string {
  const lines = body.split('\n');
  const line = lines[index];
  if (line == null) return body;
  lines[index] = line.replace(RE, (_all, lead: string, _m: string, rest: string) => `${lead}[${mark}] ${rest}`);
  return lines.join('\n');
}

export const markConverted = (body: string, index: number) => setMark(body, index, '→');
export const toggleChecked = (body: string, index: number, checked: boolean) => setMark(body, index, checked ? 'x' : ' ');

/** Body stored in content_json until the rich editor (Phase 5) migrates it. */
export interface PlainContent {
  type: 'plain';
  text: string;
}

export function bodyFromContent(content: unknown, fallback: string): string {
  if (content && typeof content === 'object' && (content as PlainContent).type === 'plain') return (content as PlainContent).text;
  return fallback;
}

/** First non-empty lines for list previews. */
export function previewOf(text: string, maxChars = 140): string {
  return text
    .split('\n')
    .map((l) => l.replace(RE, '$3').trim())
    .filter(Boolean)
    .join(' · ')
    .slice(0, maxChars);
}
