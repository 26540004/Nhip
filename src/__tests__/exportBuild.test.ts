import { buildExport, docToMarkdown, slugify } from '../lib/export/build';
import type { Attachment } from '../lib/api/types';
import type { NoteDoc } from '../lib/notes/doc';

const att = (a: Partial<Attachment> & Pick<Attachment, 'id' | 'type'>): Attachment => ({
  owner_type: 'note',
  owner_id: 'n1',
  storage_path: null,
  url: null,
  title: null,
  meta_json: {},
  created_at: '2026-11-16T00:00:00Z',
  ...a,
});

describe('export', () => {
  it('slugifies Vietnamese titles', () => {
    expect(slugify('Bài giảng TCP/IP – tuần 5')).toBe('bai-giang-tcp-ip-tuan-5');
    expect(slugify('Đồ án Đường đi')).toBe('do-an-duong-di');
    expect(slugify('!!!')).toBe('ghi-chu');
  });

  it('converts a note document to Markdown', () => {
    const doc: NoteDoc = {
      type: 'doc',
      version: 1,
      blocks: [
        { id: '1', type: 'h1', text: 'TCP' },
        { id: '2', type: 'p', text: 'Ack là **byte tiếp theo**' },
        { id: '3', type: 'number', text: 'SYN' },
        { id: '4', type: 'number', text: 'SYN-ACK' },
        { id: '5', type: 'check', text: 'Làm bài 3', checked: false, taskId: 't1' },
        { id: '6', type: 'check', text: 'Đọc slide', checked: true },
        { id: '7', type: 'link', attachmentId: 'l1' },
        { id: '8', type: 'image', attachmentId: 'i1' },
      ],
    };
    const md = docToMarkdown(
      doc,
      {
        l1: att({ id: 'l1', type: 'link', url: 'https://rfc-editor.org/rfc/rfc9293', title: 'RFC 9293' }),
        i1: att({ id: 'i1', type: 'image', storage_path: 'u/i1.jpg' }),
      },
      { 'u/i1.jpg': 'https://signed/i1' },
    );
    expect(md).toBe(
      [
        '# TCP',
        '',
        'Ack là **byte tiếp theo**',
        '',
        '1. SYN',
        '2. SYN-ACK',
        '- [ ] Làm bài 3 _(đã chuyển thành việc)_',
        '- [x] Đọc slide',
        '',
        '[RFC 9293](https://rfc-editor.org/rfc/rfc9293)',
        '',
        '![Ảnh](https://signed/i1)',
      ].join('\n'),
    );
  });

  it('builds JSON, one Markdown file per note (unique names) and the media list', () => {
    const files = buildExport({
      exportedAt: Date.parse('2026-11-17T05:00:00Z'),
      tz: 'Asia/Ho_Chi_Minh',
      links: { 'u/a1/seg-000.m4a': 'https://signed/seg0' },
      tables: {
        collections: [{ id: 'c1', name: 'Mạng máy tính' }],
        notes: [
          {
            id: 'n1',
            title: 'Ôn tập',
            space: 'study',
            collection_id: 'c1',
            pinned: true,
            created_at: '2026-11-16T01:00:00Z',
            content_json: { type: 'plain', text: '[ ] Làm đề' },
            plain_text: '',
          },
          {
            id: 'n2',
            title: 'Ôn tập',
            space: 'work',
            collection_id: null,
            pinned: false,
            created_at: '2026-11-16T02:00:00Z',
            content_json: null,
            plain_text: 'x',
          },
        ],
        tasks: [{ id: 't1', title: 'Báo cáo' }],
        attachments: [
          att({
            id: 'a1',
            type: 'audio',
            title: 'Buổi 7',
            duration_sec: 1250,
            transcript_status: 'done',
            transcript_text: '[00:05] Xin chào',
            summary_json: { main_points: ['TCP'], key_terms: [], homework: [{ title: 'Bài 3', deadline_hint: 'thứ 6' }] },
          }) as unknown as Record<string, unknown>,
        ],
        audio_segments: [{ attachment_id: 'a1', seq: 0, storage_path: 'u/a1/seg-000.m4a', duration_sec: 600 }],
      },
    });
    expect(Object.keys(files).sort()).toEqual([
      'ghi-am-va-anh.md',
      'ghi-chu/2026-11-16-on-tap-2.md',
      'ghi-chu/2026-11-16-on-tap.md',
      'nhip-du-lieu.json',
      'Đọc trước.md',
    ]);
    const json = JSON.parse(files['nhip-du-lieu.json']!);
    expect(json).toMatchObject({ app: 'Nhịp', format_version: 1, timezone: 'Asia/Ho_Chi_Minh' });
    const n1 = files['ghi-chu/2026-11-16-on-tap.md']!;
    expect(n1).toContain('collection: "Mạng máy tính"');
    expect(n1).toContain('- [ ] Làm đề');
    expect(n1).toContain('### Buổi 7 — 20:50');
    expect(n1).toContain('- [ ] Bài 3 (thứ 6)');
    expect(n1).toContain('[00:05] Xin chào');
    expect(files['ghi-am-va-anh.md']).toContain('Đoạn 1 (10:00): [tải xuống](https://signed/seg0)');
  });
});
