/**
 * Error reports for the admin's own Nhịp (pure; shared by report-error, the app and Jest).
 *
 * A report must be useful to fix a bug and useless to learn anything private:
 * no note/task text, no email, no tokens, no ids. Code scrubs everything before it is
 * stored or sent to GitHub, then groups repeats under one fingerprint (one issue each).
 */
import { z } from 'zod';

export const ReportInput = z.object({
  kind: z.enum(['crash', 'error', 'function', 'manual']),
  message: z.string().max(2000),
  stack: z.string().max(8000).optional(),
  /** Route pattern, e.g. /note/[id] (ids are scrubbed anyway). */
  route: z.string().max(200).optional(),
  /** Edge Function name + HTTP status for kind 'function'. */
  fn: z.string().max(60).optional(),
  status: z.number().int().optional(),
  /** User's own words for kind 'manual' (they're told not to put private things here). */
  description: z.string().max(2000).optional(),
  app_version: z.string().max(40),
  platform: z.enum(['ios', 'android', 'web']),
  os_version: z.string().max(40).optional(),
});
export type ReportInput = z.infer<typeof ReportInput>;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g;
const KEYISH = /\b(?:sk|pk|gsk|AIza|ghp|github_pat|sbp)[-_A-Za-z0-9]{12,}\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const URL_QUERY = /(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g;
const QUOTED = /(["'“”‘’«])([^"'“”‘’«»\n]{25,})(["'“”‘’»])/g;
const LONGNUM = /\b\d{7,}\b/g;
const PHONE = /(?:\+?84|0)(?:[\s.-]?\d){9,10}\b/g;

/** Remove anything personal from free text (messages, stacks, descriptions). */
export function scrub(text: string, max = 2000): string {
  return (
    text
      .replace(JWT, '<token>')
      .replace(KEYISH, '<key>')
      .replace(EMAIL, '<email>')
      .replace(URL_QUERY, '$1?<…>')
      .replace(UUID, '<id>')
      .replace(PHONE, '<phone>')
      .replace(LONGNUM, '<n>')
      // Long quoted strings are usually user content echoed in an error ("… 'Nộp báo cáo Mạng thứ 6' …").
      .replace(QUOTED, '$1<text>$3')
      .slice(0, max)
  );
}

/** Keep only code locations from a stack: function names and file:line, no data. */
export function scrubStack(stack: string | undefined, maxLines = 25): string {
  if (!stack) return '';
  return stack
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^at |@|\.(?:js|ts|tsx|bundle)/.test(l))
    .slice(0, maxLines)
    .map((l) => scrub(l, 300).replace(/https?:\/\/[^/\s)]+/g, ''))
    .join('\n');
}

export function scrubRoute(route: string | undefined): string {
  if (!route) return '';
  return route.replace(UUID, '[id]').replace(/\?.*$/, '').slice(0, 200);
}

/** Same bug → same fingerprint, regardless of ids, numbers or user text in the message. */
export function fingerprint(r: Pick<ReportInput, 'kind' | 'message' | 'stack' | 'fn' | 'status'>): string {
  const msg = scrub(r.message, 300)
    .replace(/\d+/g, '#')
    .replace(/<[a-z]+>/g, '_')
    .toLowerCase();
  const top = scrubStack(r.stack, 3)
    .replace(/:\d+(?::\d+)?/g, '')
    .replace(/[?&]v=[\w.]+/g, '');
  const key = [r.kind, r.fn ?? '', r.status ?? '', msg, top].join('|');
  // FNV-1a 32-bit → 8 hex chars; enough to group one app's bugs.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export interface CleanReport {
  kind: ReportInput['kind'];
  message: string;
  stack: string;
  route: string;
  fn: string | null;
  status: number | null;
  description: string;
  app_version: string;
  platform: ReportInput['platform'];
  os_version: string;
  fingerprint: string;
}

export function cleanReport(r: ReportInput): CleanReport {
  const clean = {
    kind: r.kind,
    message: scrub(r.message, 500).replace(/@/g, '＠') || '(không có thông báo)',
    stack: scrubStack(r.stack),
    route: scrubRoute(r.route),
    fn: r.fn ?? null,
    status: r.status ?? null,
    description: r.description ? scrub(r.description, 1500).replace(/@/g, '＠') : '',
    app_version: r.app_version.replace(/[^\w.+-]/g, ''),
    platform: r.platform,
    os_version: (r.os_version ?? '').replace(/[^\w. ()-]/g, ''),
  };
  return { ...clean, fingerprint: fingerprint(r) };
}

const KIND_VI: Record<ReportInput['kind'], string> = {
  crash: 'Ứng dụng bị treo',
  error: 'Lỗi',
  function: 'Lỗi máy chủ',
  manual: 'Báo lỗi thủ công',
};

export function issueTitle(c: CleanReport): string {
  const where = c.fn ? `${c.fn} ${c.status ?? ''}`.trim() : c.route || c.platform;
  const msg = c.message.split('\n')[0]!;
  const short = msg.length > 90 ? msg.slice(0, 90).replace(/\s*<[a-z…]*$/, '') + '…' : msg;
  return `[${KIND_VI[c.kind]}] ${short} — ${where}`.slice(0, 160);
}

export function issueBody(c: CleanReport): string {
  const fence = (s: string) => '```\n' + s.replace(/```/g, "'''") + '\n```';
  return [
    `Báo tự động từ Nhịp (tài khoản admin). Đã lược bỏ nội dung ghi chú/việc, email, mã định danh.`,
    '',
    `| | |`,
    `|---|---|`,
    `| Loại | ${KIND_VI[c.kind]} |`,
    `| Màn hình | \`${c.route || '—'}\` |`,
    c.fn ? `| Hàm máy chủ | \`${c.fn}\` → HTTP ${c.status ?? '?'} |` : null,
    `| Phiên bản | ${c.app_version} · ${c.platform} ${c.os_version} |`,
    `| Dấu vân tay | \`${c.fingerprint}\` |`,
    '',
    '**Thông báo lỗi**',
    fence(c.message),
    c.stack ? '**Ngăn xếp (stack)**\n' + fence(c.stack) : null,
    c.description ? '**Người dùng mô tả**\n> ' + c.description.replace(/\n/g, '\n> ') : null,
    '',
    '---',
    // The mention starts the Claude workflow (.github/workflows/claude.yml) on the owner's Pro plan.
    '@claude tìm nguyên nhân gốc, sửa, thêm test tái hiện lỗi, chạy `npm run check` rồi mở PR (không tự gộp). Đọc CLAUDE.md trước.',
    `<!-- nhip-fingerprint:${c.fingerprint} -->`,
  ]
    .filter((x) => x !== null)
    .join('\n');
}

/** Comment on an existing issue only when it is worth it: 2nd, 5th, 20th, 100th… occurrence. */
export function shouldComment(count: number): boolean {
  return count === 2 || count === 5 || count === 20 || count === 100 || (count > 100 && count % 100 === 0);
}
