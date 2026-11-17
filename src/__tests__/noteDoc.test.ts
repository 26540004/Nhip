import {
  type Block,
  docFromPlainText,
  docToPlainText,
  insertMedia,
  mergeBackward,
  normalizeDoc,
  type NoteDoc,
  numberingOf,
  parseInline,
  setBlockType,
  splitBlock,
  stripMarks,
  type TextBlock,
  toggleMark,
} from '../lib/notes/doc';

const doc = (...blocks: Block[]): NoteDoc => ({ type: 'doc', version: 1, blocks });
const t = (id: string, type: TextBlock['type'], text: string, extra: Partial<TextBlock> = {}): TextBlock => ({ id, type, text, ...extra });

describe('note doc model', () => {
  it('migrates Phase 2 plain text (headings, lists, checklists, converted lines)', () => {
    const d = docFromPlainText('# Bài giảng TCP\nBắt tay ba bước\n- SYN\n1. Bước một\n[ ] Làm bài tập\n[x] Đọc slide\n[→] Hỏi thầy');
    expect(d.blocks.map((b) => [b.type, (b as TextBlock).text, (b as TextBlock).checked ?? null])).toEqual([
      ['h1', 'Bài giảng TCP', null],
      ['p', 'Bắt tay ba bước', null],
      ['bullet', 'SYN', null],
      ['number', 'Bước một', null],
      ['check', 'Làm bài tập', false],
      ['check', 'Đọc slide', true],
      ['check', 'Hỏi thầy', false],
    ]);
    expect((d.blocks[6] as TextBlock).taskId).toBe('converted');
    expect(normalizeDoc({ type: 'plain', text: 'a' }).blocks[0]).toMatchObject({ type: 'p', text: 'a' });
    expect(normalizeDoc(null, '').blocks).toHaveLength(1);
  });

  it('inline marks parse, strip and toggle', () => {
    expect(parseInline('a **đậm** và _nghiêng_ **_cả hai_**')).toEqual([
      { text: 'a ' },
      { text: 'đậm', bold: true },
      { text: ' và ' },
      { text: 'nghiêng', italic: true },
      { text: ' ' },
      { text: 'cả hai', bold: true, italic: true },
    ]);
    expect(stripMarks('x **y** _z_ **unclosed')).toBe('x y z **unclosed');
    const on = toggleMark('hello world', { start: 6, end: 11 }, 'bold');
    expect(on).toEqual({ text: 'hello **world**', selection: { start: 8, end: 13 } });
    expect(toggleMark(on.text, on.selection, 'bold')).toEqual({ text: 'hello world', selection: { start: 6, end: 11 } });
    expect(toggleMark('ab', { start: 1, end: 1 }, 'italic')).toEqual({ text: 'a__b', selection: { start: 2, end: 2 } });
  });

  it('Enter continues lists, empty list item becomes a paragraph', () => {
    const d = doc(t('a', 'bullet', 'một hai'));
    const r = splitBlock(d, 'a', 3);
    expect(r.doc.blocks.map((b) => [b.type, (b as TextBlock).text])).toEqual([
      ['bullet', 'một'],
      ['bullet', ' hai'],
    ]);
    const empty = splitBlock(doc(t('a', 'check', '', { checked: false })), 'a', 0);
    expect(empty.doc.blocks).toEqual([{ id: 'a', type: 'p', text: '' }]);
    const h = splitBlock(doc(t('a', 'h1', 'Tiêu đề')), 'a', 7);
    expect(h.doc.blocks[1]).toMatchObject({ type: 'p', text: '' });
  });

  it('Backspace at start: list → paragraph, paragraph merges into previous text', () => {
    const d = doc(t('a', 'p', 'xin '), t('b', 'p', 'chào'));
    const r = mergeBackward(d, 'b');
    expect(r).toMatchObject({ focusId: 'a', caret: 4 });
    expect(r.doc.blocks).toEqual([{ id: 'a', type: 'p', text: 'xin chào' }]);
    expect(mergeBackward(doc(t('a', 'bullet', 'x')), 'a').doc.blocks[0]).toEqual({ id: 'a', type: 'p', text: 'x' });
  });

  it('media insertion keeps a paragraph to continue typing; plain text + numbering', () => {
    const d = insertMedia(doc(t('a', 'p', 'Ảnh bảng:')), 'a', 'image', 'att-1');
    expect(d.doc.blocks.map((b) => b.type)).toEqual(['p', 'image', 'p']);
    const n = doc(t('1', 'number', 'a'), t('2', 'number', 'b'), t('3', 'p', 'x'), t('4', 'number', 'c'));
    expect([...numberingOf(n).values()]).toEqual([1, 2, 1]);
    const typed = setBlockType(doc(t('a', 'p', '**Mục** tiêu')), 'a', 'check');
    expect(docToPlainText(typed)).toBe('[ ] Mục tiêu');
    expect(docToPlainText(setBlockType(typed, 'a', 'check'))).toBe('Mục tiêu'); // toggled off
    expect(docToPlainText(n)).toBe('1. a\n2. b\nx\n1. c');
  });
});
