/**
 * Note content model (stored in notes.content_json). Pure, platform-free, unit-tested.
 *
 * A note is a list of blocks. Text blocks carry inline marks as lightweight markup:
 * **đậm** and _nghiêng_. That keeps content plain JSON, editable with a normal TextInput on
 * iOS and web (no WebView editor), and searchable through notes.plain_text.
 *
 *   { type: 'doc', version: 1, blocks: [
 *       { id, type: 'h1' | 'h2' | 'p' | 'bullet' | 'number' | 'check', text, checked? },
 *       { id, type: 'image' | 'link' | 'audio', attachmentId } ] }
 */
export type TextBlockType = 'h1' | 'h2' | 'p' | 'bullet' | 'number' | 'check';
export type MediaBlockType = 'image' | 'link' | 'audio';

export interface TextBlock {
  id: string;
  type: TextBlockType;
  text: string;
  checked?: boolean;
  /** Task created from this checklist line ("Chuyển thành việc"). */
  taskId?: string | null;
}

export interface MediaBlock {
  id: string;
  type: MediaBlockType;
  attachmentId: string;
}

export type Block = TextBlock | MediaBlock;

export interface NoteDoc {
  type: 'doc';
  version: 1;
  blocks: Block[];
}

export const isTextBlock = (b: Block): b is TextBlock => b.type !== 'image' && b.type !== 'link' && b.type !== 'audio';

let counter = 0;
/** Short, unique-enough ids for blocks inside one note. */
export function blockId(): string {
  counter = (counter + 1) % 1_000_000;
  return `b${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function emptyDoc(): NoteDoc {
  return { type: 'doc', version: 1, blocks: [{ id: blockId(), type: 'p', text: '' }] };
}

// ---------------------------------------------------------------------------
// Migration from the Phase 2 plain-text format
// ---------------------------------------------------------------------------

const CHECK_RE = /^\s*(?:[-*]\s+)?\[( |x|X|→)\]\s*(.*)$/;

export function docFromPlainText(text: string): NoteDoc {
  const blocks: Block[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const check = CHECK_RE.exec(line);
    if (check) {
      blocks.push({
        id: blockId(),
        type: 'check',
        text: check[2]!.trim(),
        checked: check[1] === 'x' || check[1] === 'X',
        taskId: check[1] === '→' ? 'converted' : null,
      });
    } else if (/^#{2}\s+/.test(line)) blocks.push({ id: blockId(), type: 'h2', text: line.replace(/^#{2}\s+/, '') });
    else if (/^#\s+/.test(line)) blocks.push({ id: blockId(), type: 'h1', text: line.replace(/^#\s+/, '') });
    else if (/^\s*[-*•]\s+/.test(line)) blocks.push({ id: blockId(), type: 'bullet', text: line.replace(/^\s*[-*•]\s+/, '') });
    else if (/^\s*\d+[.)]\s+/.test(line)) blocks.push({ id: blockId(), type: 'number', text: line.replace(/^\s*\d+[.)]\s+/, '') });
    else blocks.push({ id: blockId(), type: 'p', text: line });
  }
  // Collapse leading/trailing empty paragraphs from the migration.
  while (blocks.length > 1 && isTextBlock(blocks[blocks.length - 1]!) && (blocks[blocks.length - 1] as TextBlock).text === '') blocks.pop();
  return { type: 'doc', version: 1, blocks: blocks.length ? blocks : emptyDoc().blocks };
}

/** Accepts any stored content_json (new doc, Phase 2 {type:'plain'}, or nothing). */
export function normalizeDoc(content: unknown, fallbackPlain = ''): NoteDoc {
  if (content && typeof content === 'object') {
    const c = content as { type?: string; blocks?: unknown; text?: unknown };
    if (c.type === 'doc' && Array.isArray(c.blocks) && c.blocks.length > 0) return { type: 'doc', version: 1, blocks: c.blocks as Block[] };
    if (c.type === 'plain' && typeof c.text === 'string') return docFromPlainText(c.text);
  }
  return fallbackPlain ? docFromPlainText(fallbackPlain) : emptyDoc();
}

// ---------------------------------------------------------------------------
// Inline marks
// ---------------------------------------------------------------------------

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

/** "a **b** _c_" → spans. Unclosed markers are kept as literal text. */
export function parseInline(text: string): Span[] {
  const out: Span[] = [];
  const re = /\*\*(.+?)\*\*|_(.+?)_/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    if (m[1] != null) {
      // nested italic inside bold
      for (const inner of parseInline(m[1])) out.push({ ...inner, bold: true });
    } else out.push({ text: m[2]!, italic: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.filter((s) => s.text.length > 0);
}

export function stripMarks(text: string): string {
  return parseInline(text)
    .map((s) => s.text)
    .join('');
}

/**
 * Toggle a mark around the selection (or insert empty markers at the caret).
 * Returns the new text and the selection to restore.
 */
export function toggleMark(
  text: string,
  sel: { start: number; end: number },
  mark: 'bold' | 'italic',
): { text: string; selection: { start: number; end: number } } {
  const m = mark === 'bold' ? '**' : '_';
  const { start, end } = sel;
  const before = text.slice(0, start);
  const inner = text.slice(start, end);
  const after = text.slice(end);
  // Already wrapped (markers just outside the selection) → unwrap.
  if (before.endsWith(m) && after.startsWith(m)) {
    return {
      text: before.slice(0, -m.length) + inner + after.slice(m.length),
      selection: { start: start - m.length, end: end - m.length },
    };
  }
  // Selection includes the markers → unwrap.
  if (inner.startsWith(m) && inner.endsWith(m) && inner.length >= 2 * m.length) {
    const un = inner.slice(m.length, inner.length - m.length);
    return { text: before + un + after, selection: { start, end: start + un.length } };
  }
  return { text: before + m + inner + m + after, selection: { start: start + m.length, end: end + m.length } };
}

// ---------------------------------------------------------------------------
// Block editing operations (immutable)
// ---------------------------------------------------------------------------

const LIST_TYPES: TextBlockType[] = ['bullet', 'number', 'check'];

/** Enter at `offset` in block `id`: split it; lists continue, an empty list item becomes a paragraph. */
export function splitBlock(doc: NoteDoc, id: string, offset: number): { doc: NoteDoc; focusId: string } {
  const i = doc.blocks.findIndex((b) => b.id === id);
  const b = doc.blocks[i];
  if (!b || !isTextBlock(b)) return { doc, focusId: id };
  if (LIST_TYPES.includes(b.type) && b.text.trim() === '') {
    const blocks = [...doc.blocks];
    blocks[i] = { id: b.id, type: 'p', text: '' };
    return { doc: { ...doc, blocks }, focusId: b.id };
  }
  const head: TextBlock = { ...b, text: b.text.slice(0, offset) };
  const nextType: TextBlockType = LIST_TYPES.includes(b.type) ? b.type : 'p';
  const tail: TextBlock = {
    id: blockId(),
    type: nextType,
    text: b.text.slice(offset),
    ...(nextType === 'check' ? { checked: false, taskId: null } : {}),
  };
  const blocks = [...doc.blocks.slice(0, i), head, tail, ...doc.blocks.slice(i + 1)];
  return { doc: { ...doc, blocks }, focusId: tail.id };
}

/** Backspace at the start of a block: lists/headings become paragraphs; paragraphs merge into the previous text block. */
export function mergeBackward(doc: NoteDoc, id: string): { doc: NoteDoc; focusId: string; caret: number } {
  const i = doc.blocks.findIndex((b) => b.id === id);
  const b = doc.blocks[i];
  if (!b || !isTextBlock(b)) return { doc, focusId: id, caret: 0 };
  if (b.type !== 'p') {
    const blocks = [...doc.blocks];
    blocks[i] = { id: b.id, type: 'p', text: b.text };
    return { doc: { ...doc, blocks }, focusId: b.id, caret: 0 };
  }
  const prev = doc.blocks[i - 1];
  if (!prev) return { doc, focusId: id, caret: 0 };
  if (!isTextBlock(prev)) {
    // Previous is media: remove the empty paragraph only.
    if (b.text !== '') return { doc, focusId: id, caret: 0 };
    return { doc: { ...doc, blocks: doc.blocks.filter((x) => x.id !== id) }, focusId: prev.id, caret: 0 };
  }
  const blocks = [...doc.blocks];
  blocks[i - 1] = { ...prev, text: prev.text + b.text };
  blocks.splice(i, 1);
  return { doc: { ...doc, blocks }, focusId: prev.id, caret: prev.text.length };
}

export function updateBlock(doc: NoteDoc, id: string, patch: Partial<TextBlock>): NoteDoc {
  return { ...doc, blocks: doc.blocks.map((b) => (b.id === id && isTextBlock(b) ? { ...b, ...patch } : b)) };
}

export function setBlockType(doc: NoteDoc, id: string, type: TextBlockType): NoteDoc {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => {
      if (b.id !== id || !isTextBlock(b)) return b;
      const nextType = b.type === type ? 'p' : type; // toggle off when applied twice
      return { id: b.id, type: nextType, text: b.text, ...(nextType === 'check' ? { checked: false, taskId: null } : {}) };
    }),
  };
}

/** Insert a media block after `afterId` (or at the end), followed by an empty paragraph to keep typing. */
export function insertMedia(
  doc: NoteDoc,
  afterId: string | null,
  type: MediaBlockType,
  attachmentId: string,
): { doc: NoteDoc; focusId: string } {
  const media: MediaBlock = { id: blockId(), type, attachmentId };
  const para: TextBlock = { id: blockId(), type: 'p', text: '' };
  const i = afterId ? doc.blocks.findIndex((b) => b.id === afterId) : doc.blocks.length - 1;
  const at = i < 0 ? doc.blocks.length : i + 1;
  const blocks = [...doc.blocks.slice(0, at), media, para, ...doc.blocks.slice(at)];
  return { doc: { ...doc, blocks }, focusId: para.id };
}

export function removeBlock(doc: NoteDoc, id: string): NoteDoc {
  const blocks = doc.blocks.filter((b) => b.id !== id);
  return { ...doc, blocks: blocks.length ? blocks : emptyDoc().blocks };
}

/** Plain text for search and list previews: marks stripped, list markers kept readable. */
export function docToPlainText(doc: NoteDoc): string {
  let n = 0;
  return doc.blocks
    .map((b) => {
      if (!isTextBlock(b)) return '';
      const t = stripMarks(b.text);
      if (b.type !== 'number') n = 0;
      switch (b.type) {
        case 'bullet':
          return `• ${t}`;
        case 'number':
          return `${++n}. ${t}`;
        case 'check':
          return `[${b.taskId ? '→' : b.checked ? 'x' : ' '}] ${t}`;
        default:
          return t;
      }
    })
    .filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== ''))
    .join('\n')
    .trim();
}

/** Ordinal of each numbered item (restarts after any non-number block). */
export function numberingOf(doc: NoteDoc): Map<string, number> {
  const map = new Map<string, number>();
  let n = 0;
  for (const b of doc.blocks) {
    if (b.type === 'number') map.set(b.id, ++n);
    else n = 0;
  }
  return map;
}

export function attachmentIdsOf(doc: NoteDoc): string[] {
  return doc.blocks.filter((b): b is MediaBlock => !isTextBlock(b)).map((b) => b.attachmentId);
}
