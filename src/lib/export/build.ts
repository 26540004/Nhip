/**
 * Data export (pure, unit-tested). Turns the user's rows into text files:
 *   Đọc trước.md            what is inside
 *   nhip-du-lieu.json       every table (no secrets, no device tokens, no Google event cache)
 *   ghi-chu/<ngày>-<tên>.md one Markdown file per note, with recording summaries + transcripts
 *   ghi-am-va-anh.md        recordings (segments) and images with download links (7 days)
 */
import { formatClock } from '../../../supabase/functions/_shared/transcribe-core.ts';
import { vi } from '../../i18n/vi';
import type { Attachment, TranscriptSummary } from '../api/types';
import { isTextBlock, normalizeDoc, type NoteDoc, numberingOf, stripMarks } from '../notes/doc';

type Row = Record<string, unknown>;

export interface ExportInput {
  exportedAt: number;
  tz: string;
  tables: Record<string, Row[]>;
  /** storage path → signed download URL (may be missing offline) */
  links: Record<string, string>;
}

export function slugify(s: string, max = 48): string {
  const base = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
  return base || 'ghi-chu';
}

const yaml = (v: unknown) => JSON.stringify(v ?? null);

function attachmentLine(a: Attachment | undefined, links: Record<string, string>): string {
  if (!a) return `> ${vi.notes.missingAttachment}`;
  if (a.type === 'link') return `[${a.title || a.url}](${a.url})`;
  if (a.type === 'image') {
    const url = a.storage_path ? (links[a.storage_path] ?? a.storage_path) : '';
    return `![${a.title ?? 'Ảnh'}](${url})`;
  }
  const dur = a.duration_sec ? ` (${formatClock(a.duration_sec)})` : '';
  return `> 🎙 ${a.title ?? 'Ghi âm'}${dur} — xem phần "Ghi âm" cuối tệp và ghi-am-va-anh.md`;
}

export function docToMarkdown(doc: NoteDoc, attachments: Record<string, Attachment>, links: Record<string, string> = {}): string {
  const ordinals = numberingOf(doc);
  const out: string[] = [];
  let prevList = false;
  for (const b of doc.blocks) {
    const isList = b.type === 'bullet' || b.type === 'number' || b.type === 'check';
    if (out.length > 0 && !(isList && prevList)) out.push('');
    prevList = isList;
    if (!isTextBlock(b)) {
      out.push(attachmentLine(attachments[b.attachmentId], links));
      continue;
    }
    switch (b.type) {
      case 'h1':
        out.push(`# ${b.text}`);
        break;
      case 'h2':
        out.push(`## ${b.text}`);
        break;
      case 'bullet':
        out.push(`- ${b.text}`);
        break;
      case 'number':
        out.push(`${ordinals.get(b.id) ?? 1}. ${b.text}`);
        break;
      case 'check':
        out.push(`- [${b.checked ? 'x' : ' '}] ${b.text}${b.taskId ? ' _(đã chuyển thành việc)_' : ''}`);
        break;
      default:
        out.push(b.text);
    }
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function recordingSection(a: Attachment): string {
  const lines = [`### ${a.title ?? 'Ghi âm'}${a.duration_sec ? ` — ${formatClock(a.duration_sec)}` : ''}`];
  const s = a.summary_json as TranscriptSummary | null | undefined;
  if (s) {
    if (s.main_points.length) lines.push('', `**${vi.transcript.mainPoints}**`, ...s.main_points.map((p) => `- ${p}`));
    if (s.key_terms.length)
      lines.push('', `**${vi.transcript.keyTerms}**`, ...s.key_terms.map((k) => `- **${k.term}** — ${k.explanation}`));
    if (s.homework.length)
      lines.push(
        '',
        `**${vi.transcript.homework}**`,
        ...s.homework.map((h) => `- [ ] ${h.title}${h.deadline_hint ? ` (${h.deadline_hint})` : ''}`),
      );
  }
  if (a.transcript_text) lines.push('', `**${vi.transcript.transcript}**`, '', a.transcript_text);
  else if (a.transcript_status === 'processing') lines.push('', '_Đang phiên âm._');
  return lines.join('\n');
}

export function buildExport(input: ExportInput): Record<string, string> {
  const { tables, links } = input;
  const files: Record<string, string> = {};
  const collections = new Map((tables.collections ?? []).map((c) => [String(c.id), String(c.name)]));
  const attachments = (tables.attachments ?? []) as unknown as Attachment[];
  const byId = Object.fromEntries(attachments.map((a) => [a.id, a]));
  const segments = (tables.audio_segments ?? []) as {
    attachment_id: string;
    seq: number;
    storage_path: string;
    duration_sec: number | string;
  }[];

  const exportedIso = new Date(input.exportedAt).toISOString();
  files['nhip-du-lieu.json'] = JSON.stringify(
    { app: 'Nhịp', format_version: 1, exported_at: exportedIso, timezone: input.tz, tables },
    null,
    2,
  );

  // Notes → Markdown
  const used = new Set<string>();
  const notes = [...(tables.notes ?? [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  for (const n of notes) {
    const title = String(n.title || vi.notes.untitled);
    const day = String(n.created_at ?? exportedIso).slice(0, 10);
    let name = `ghi-chu/${day}-${slugify(title)}.md`;
    for (let i = 2; used.has(name); i++) name = `ghi-chu/${day}-${slugify(title)}-${i}.md`;
    used.add(name);
    const doc = normalizeDoc(n.content_json, String(n.plain_text ?? ''));
    const recs = attachments.filter((a) => a.owner_id === n.id && a.type === 'audio');
    const front = [
      '---',
      `title: ${yaml(title)}`,
      `space: ${yaml(vi.space[n.space as 'study' | 'work'] ?? n.space)}`,
      `collection: ${yaml(n.collection_id ? collections.get(String(n.collection_id)) : null)}`,
      `pinned: ${n.pinned ? 'true' : 'false'}`,
      `created: ${yaml(n.created_at)}`,
      `updated: ${yaml(n.updated_at)}`,
      '---',
    ].join('\n');
    const body = docToMarkdown(doc, byId, links);
    const recText = recs.length ? `\n\n## Ghi âm\n\n${recs.map(recordingSection).join('\n\n')}` : '';
    files[name] = `${front}\n\n# ${title}\n\n${body}${recText}\n`;
  }

  // Recordings and images with links
  const ownerTitle = (a: Attachment) => {
    const list = a.owner_type === 'note' ? tables.notes : tables.tasks;
    return String(list?.find((x) => x.id === a.owner_id)?.title ?? '—');
  };
  const media: string[] = ['# Ghi âm và ảnh', '', `Xuất lúc ${exportedIso}. Đường tải xuống có hạn 7 ngày; sau đó mở Nhịp để tải lại.`];
  const audio = attachments.filter((a) => a.type === 'audio');
  media.push('', `## Ghi âm (${audio.length})`);
  for (const a of audio) {
    media.push(
      '',
      `### ${a.title ?? 'Ghi âm'} — ${ownerTitle(a)}`,
      `- Thời lượng: ${a.duration_sec ? formatClock(a.duration_sec) : '—'}`,
      `- Phiên âm: ${a.transcript_status ?? 'none'}`,
    );
    const segs = segments.filter((s) => s.attachment_id === a.id).sort((x, y) => x.seq - y.seq);
    for (const s of segs) {
      const link = links[s.storage_path];
      media.push(
        `- Đoạn ${s.seq + 1} (${formatClock(Number(s.duration_sec))}): ${link ? `[tải xuống](${link})` : `\`${s.storage_path}\``}`,
      );
    }
    if (segs.length === 0) media.push('- (chưa có đoạn nào được tải lên)');
  }
  const images = attachments.filter((a) => a.type === 'image');
  media.push('', `## Ảnh (${images.length})`);
  for (const a of images) {
    const link = a.storage_path ? links[a.storage_path] : null;
    media.push(`- ${ownerTitle(a)}: ${link ? `[tải xuống](${link})` : `\`${a.storage_path ?? '—'}\``}`);
  }
  files['ghi-am-va-anh.md'] = `${media.join('\n')}\n`;

  const count = (k: string) => (tables[k] ?? []).length;
  files['Đọc trước.md'] = [
    '# Dữ liệu Nhịp',
    '',
    `Xuất lúc ${exportedIso} (múi giờ ${input.tz}).`,
    '',
    `- \`nhip-du-lieu.json\`: toàn bộ dữ liệu — ${count('tasks')} việc, ${count('notes')} ghi chú, ${count('collections')} môn học/dự án, ${count('task_blocks')} khối lịch, cài đặt.`,
    `- \`ghi-chu/\`: ${notes.length} ghi chú dạng Markdown (kèm tóm tắt và bản chép lời ghi âm).`,
    `- \`ghi-am-va-anh.md\`: ${audio.length} bản ghi âm và ${images.length} ảnh, kèm đường tải xuống có hạn 7 ngày.`,
    '',
    'Không bao gồm: mã truy cập Google, thiết bị nhận thông báo, bộ đệm sự kiện Google Calendar.',
    '',
  ].join('\n');

  return files;
}

/** Plain text of a note used in exports and previews (marks stripped). */
export function noteTitleOrUntitled(n: Row): string {
  return stripMarks(String(n.title ?? '')) || vi.notes.untitled;
}
