import { bodyFromContent, markConverted, parseChecklist, previewOf, toggleChecked } from '../lib/notes/checklist';

const body = ['Bài giảng TCP', '[ ] Làm bài tập 3', '- [x] Đọc chương 2', 'ghi chú thường', '  * [ ] Hỏi thầy về lab', '[ ]   '].join('\n');

describe('note checklist', () => {
  it('finds checklist lines with state', () => {
    expect(parseChecklist(body)).toEqual([
      { index: 1, text: 'Làm bài tập 3', checked: false, converted: false },
      { index: 2, text: 'Đọc chương 2', checked: true, converted: false },
      { index: 4, text: 'Hỏi thầy về lab', checked: false, converted: false },
    ]);
  });

  it('marks a line converted and toggles checks, preserving list markers', () => {
    const converted = markConverted(body, 4);
    expect(converted.split('\n')[4]).toBe('  * [→] Hỏi thầy về lab');
    expect(parseChecklist(converted).find((l) => l.index === 4)?.converted).toBe(true);
    expect(toggleChecked(body, 1, true).split('\n')[1]).toBe('[x] Làm bài tập 3');
    expect(toggleChecked(body, 2, false).split('\n')[2]).toBe('- [ ] Đọc chương 2');
  });

  it('content round trip and preview', () => {
    expect(bodyFromContent({ type: 'plain', text: 'abc' }, 'x')).toBe('abc');
    expect(bodyFromContent({}, 'fallback')).toBe('fallback');
    expect(previewOf(body)).toBe('Bài giảng TCP · Làm bài tập 3 · Đọc chương 2 · ghi chú thường · Hỏi thầy về lab');
  });
});
