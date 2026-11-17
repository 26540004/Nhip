#!/usr/bin/env node
/**
 * Seed a Nhịp account with realistic sample data:
 *   2 subjects, 2 projects, a weekly timetable (+ 2 exceptions), office hours, study windows,
 *   capacity, 15 tasks with varied deadlines (some with subtasks, one overdue, one that
 *   cannot fit before its deadline), and 5 notes with attachments (links + images).
 *
 * Usage (service role key — run on your computer, never ship it in the app):
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… \
 *     node scripts/seed/seed.mjs --email ban@example.com [--wipe]
 *   (or --user <uuid>). Sign in to the app once first so the account exists.
 *   --wipe deletes the account's existing tasks, notes, subjects/projects and timetable first.
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Cần SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const TZ_OFFSET = '+07:00'; // Asia/Ho_Chi_Minh has no DST

async function resolveUser() {
  if (arg('user')) return arg('user');
  const email = arg('email');
  if (!email) throw new Error('Thiếu --email hoặc --user');
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
    if (u) return u.id;
    if (data.users.length < 200) break;
  }
  throw new Error(`Không tìm thấy tài khoản ${email}. Hãy đăng nhập app một lần trước.`);
}

const must = async (p, what) => {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

// ---- dates (local +07:00) -------------------------------------------------------------
const now = new Date();
const localNow = new Date(now.getTime() + 7 * 3600_000);
const todayKey = localNow.toISOString().slice(0, 10);
const addDays = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (key) => new Date(`${key}T00:00:00Z`).getUTCDay();
const at = (key, hhmm) => `${key}T${hhmm}:00${TZ_OFFSET}`;
const nextWeekday = (wd, from = todayKey, includeToday = false) => {
  for (let i = includeToday ? 0 : 1; i < 8; i++) if (weekday(addDays(from, i)) === wd) return addDays(from, i);
  return addDays(from, 7);
};

// ---- tiny PNG encoder (no canvas needed) ------------------------------------------------
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function png(width, height, paint) {
  const px = Buffer.alloc(width * height * 3);
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 3;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  };
  paint({ set, rect: (x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, c); }, width, height });
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) px.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const whiteboard = () =>
  png(960, 600, ({ rect, set }) => {
    rect(0, 0, 960, 600, [244, 241, 234]);
    rect(150, 120, 6, 440, [31, 41, 55]);
    rect(804, 120, 6, 440, [31, 41, 55]);
    const arrow = (y0, y1, dir, c) => {
      for (let t = 0; t <= 640; t++) {
        const x = dir > 0 ? 160 + t : 800 - t;
        const y = Math.round(y0 + ((y1 - y0) * t) / 640);
        for (let k = -2; k <= 2; k++) set(x, y + k, c);
      }
    };
    arrow(200, 280, 1, [37, 99, 235]);
    arrow(320, 400, -1, [220, 38, 38]);
    arrow(440, 520, 1, [22, 163, 74]);
  });
const chart = () =>
  png(960, 600, ({ rect }) => {
    rect(0, 0, 960, 600, [250, 250, 252]);
    rect(80, 540, 820, 4, [60, 60, 70]);
    [180, 260, 220, 340, 300, 420].forEach((h, i) => rect(110 + i * 130, 540 - h, 80, h, i === 5 ? [124, 92, 255] : [63, 182, 255]));
  });

// ---- main ---------------------------------------------------------------------------------
const uid = await resolveUser();
const existing = await must(db.from('collections').select('id').eq('user_id', uid), 'collections');
if (existing.length && !flag('wipe')) {
  console.error('Tài khoản đã có dữ liệu. Chạy lại với --wipe để xóa và tạo dữ liệu mẫu mới.');
  process.exit(2);
}
if (flag('wipe')) {
  for (const t of ['task_blocks', 'attachments', 'tasks', 'notes', 'schedule_exceptions', 'class_sessions', 'collections', 'study_windows', 'ai_proposals'])
    await must(db.from(t).delete().eq('user_id', uid), `wipe ${t}`);
  console.log('Đã xóa dữ liệu cũ.');
}

const id = () => randomUUID();
const C = { mang: id(), csdl: id(), web: id(), quy: id() };
await must(
  db.from('collections').insert([
    { id: C.mang, user_id: uid, space: 'study', kind: 'subject', name: 'Mạng máy tính', color_variant: 0 },
    { id: C.csdl, user_id: uid, space: 'study', kind: 'subject', name: 'Cơ sở dữ liệu', color_variant: 1 },
    { id: C.web, user_id: uid, space: 'work', kind: 'project', name: 'Website An Phát', color_variant: 0 },
    { id: C.quy, user_id: uid, space: 'work', kind: 'project', name: 'Báo cáo quý IV', color_variant: 1 },
  ]),
  'collections',
);

// Office hours Mon–Fri 08:00–17:00, lunch 12:00–13:00; study windows; capacity.
await must(
  db.from('work_hours').upsert(
    [0, 1, 2, 3, 4, 5, 6].map((d) => ({ user_id: uid, weekday: d, start_time: '08:00', end_time: '17:00', break_start: '12:00', break_end: '13:00', enabled: d >= 1 && d <= 5 })),
    { onConflict: 'user_id,weekday' },
  ),
  'work_hours',
);
await must(db.from('study_windows').delete().eq('user_id', uid), 'study_windows reset');
await must(
  db.from('study_windows').insert([0, 1, 2, 3, 4, 5, 6].map((d) => ({ user_id: uid, weekday: d, start_time: d === 0 || d === 6 ? '08:00' : '19:00', end_time: d === 0 || d === 6 ? '22:00' : '22:30' }))),
  'study_windows',
);
await must(
  db.from('capacity_settings').upsert(
    [0, 1, 2, 3, 4, 5, 6].flatMap((d) => [
      { user_id: uid, space: 'work', weekday: d, max_focus_minutes: d >= 1 && d <= 5 ? 360 : 0 },
      { user_id: uid, space: 'study', weekday: d, max_focus_minutes: d >= 1 && d <= 5 ? 150 : 300 },
    ]),
    { onConflict: 'user_id,space,weekday' },
  ),
  'capacity',
);

// Weekly timetable: evening/weekend classes of a working student.
const S = { mangT3: id(), mangT7: id(), csdlT5: id(), csdlCN: id() };
await must(
  db.from('class_sessions').insert([
    { id: S.mangT3, user_id: uid, collection_id: C.mang, weekday: 2, start_time: '18:00', end_time: '20:15', location: 'B1.12' },
    { id: S.mangT7, user_id: uid, collection_id: C.mang, weekday: 6, start_time: '07:30', end_time: '11:00', location: 'Lab C3' },
    { id: S.csdlT5, user_id: uid, collection_id: C.csdl, weekday: 4, start_time: '18:00', end_time: '20:15', location: 'C2.05' },
    { id: S.csdlCN, user_id: uid, collection_id: C.csdl, weekday: 0, start_time: '13:00', end_time: '15:15', location: 'C2.05' },
  ]),
  'class_sessions',
);
const nextThu = nextWeekday(4);
const nextSat = nextWeekday(6);
await must(
  db.from('schedule_exceptions').insert([
    { user_id: uid, class_session_id: S.csdlT5, date: nextThu, type: 'cancelled', new_start_at: null, new_end_at: null, note: 'Thầy đi hội thảo' },
    { user_id: uid, class_session_id: S.csdlT5, date: nextSat, type: 'extra', new_start_at: at(nextSat, '14:00'), new_end_at: at(nextSat, '16:15'), note: 'Học bù' },
  ]),
  'schedule_exceptions',
);

// 15 tasks with varied deadlines
const T = (title, space, col, deadline, est, prio, reason, extra = {}) => ({
  id: id(),
  user_id: uid,
  title,
  space,
  collection_id: col,
  deadline_at: deadline,
  estimate_minutes: est,
  priority: prio,
  priority_reason: reason,
  status: 'todo',
  source: 'form',
  ...extra,
});
const d = (n) => addDays(todayKey, n);
const tasks = [
  T('Nộp bài lab 3 Mạng máy tính', 'study', C.mang, at(d(-1), '23:59'), 90, 1, 'Đã quá hạn 1 ngày'),
  T('Gửi mockup trang chủ cho anh Minh', 'work', C.web, at(d(-2), '17:00'), 60, 1, 'Quá hạn, khách đang chờ'),
  T('Họp tiến độ An Phát', 'work', C.web, at(d(0), '16:00'), 45, 2, 'Hôm nay 16:00'),
  T('Ôn câu hỏi trắc nghiệm CSDL', 'study', C.csdl, at(d(0), '23:59'), 60, 2, 'Hạn hôm nay'),
  T('Chuẩn bị số liệu doanh thu tháng 10', 'work', C.quy, at(d(1), '10:00'), 360, 1, 'Ngày mai 10:00 nhưng cần 6 giờ'),
  T('Đọc chương 4: Tầng mạng', 'study', C.mang, at(d(1), '23:59'), 75, 2, 'Trước buổi học tới'),
  T('Viết báo cáo môn Mạng', 'study', C.mang, at(d(4), '23:59'), 240, 1, 'Còn 4 ngày, việc lớn'),
  T('Thiết kế CSDL cho đồ án', 'study', C.csdl, at(d(5), '23:59'), 180, 1, 'Đồ án nhóm, hạn tuần này'),
  T('Sửa lỗi responsive trang sản phẩm', 'work', C.web, at(d(3), '17:00'), 120, 2, 'Cần trước buổi demo'),
  T('Tổng hợp chi phí quý IV', 'work', C.quy, at(d(8), '17:00'), 150, 2, 'Tuần sau'),
  T('Làm slide thuyết trình đồ án CSDL', 'study', C.csdl, at(d(10), '23:59'), 120, 3, 'Còn hơn 1 tuần'),
  T('Viết email tổng kết dự án An Phát', 'work', C.web, at(d(12), '17:00'), 30, 3, 'Không gấp'),
  T('Ôn thi giữa kỳ Mạng máy tính', 'study', C.mang, at(d(20), '23:59'), 300, 2, 'Còn 3 tuần, nên bắt đầu sớm'),
  T('Đọc tài liệu chuẩn hóa dữ liệu', 'study', C.csdl, null, 45, 3, 'Không có hạn'),
  T('Dọn dẹp thư mục Drive dự án', 'work', null, null, 30, 3, 'Không có hạn', { status: 'done', completed_at: now.toISOString() }),
];
const report = tasks[6];
const subtasks = [
  ['Thu thập số liệu Wireshark', 60],
  ['Vẽ sơ đồ mạng', 45],
  ['Viết phần phân tích', 90],
  ['Rà soát & nộp', 45],
].map(([title, est], i) => T(title, 'study', C.mang, report.deadline_at, est, 1, '', { parent_task_id: report.id, sort_order: i, source: 'ai_split' }));
await must(db.from('tasks').insert([...tasks, ...subtasks], { defaultToNull: false }), 'tasks');

// 5 notes with attachments
const doc = (...blocks) => ({ type: 'doc', version: 1, blocks: blocks.map((b, i) => ({ id: `s${i}`, ...b })) });
const plain = (dc) => dc.blocks.filter((b) => b.text != null).map((b) => b.text.replace(/\*\*|_/g, '')).join('\n');
const notes = [];
const attachments = [];
const uploads = [];
const note = (title, space, col, content, pinned = false) => {
  const n = { id: id(), user_id: uid, title, space, collection_id: col, content_json: content, plain_text: plain(content), pinned };
  notes.push(n);
  return n.id;
};
const link = (owner, urlStr, title, description, site) => {
  const a = { id: id(), user_id: uid, owner_type: 'note', owner_id: owner, type: 'link', url: urlStr, title, meta_json: { description, image: null, site_name: site, preview: 'ok' } };
  attachments.push(a);
  return a.id;
};
const image = (owner, bytes) => {
  const aid = id();
  const path = `${uid}/${aid}.png`;
  uploads.push([path, bytes]);
  attachments.push({ id: aid, user_id: uid, owner_type: 'note', owner_id: owner, type: 'image', storage_path: path, meta_json: { width: 960, height: 600, thumb_path: path } });
  return aid;
};

const n1 = id();
const n1img = image(n1, whiteboard());
const n1link = link(n1, 'https://www.rfc-editor.org/rfc/rfc9293', 'RFC 9293: Transmission Control Protocol (TCP)', 'Đặc tả chuẩn của TCP (2022).', 'RFC Editor');
notes.push({
  id: n1,
  user_id: uid,
  title: 'Mạng máy tính — Buổi 7: TCP',
  space: 'study',
  collection_id: C.mang,
  pinned: true,
  content_json: doc(
    { type: 'h1', text: 'TCP' },
    { type: 'p', text: '**ack = số byte tiếp theo mong nhận**, _không phải_ số vừa nhận.' },
    { type: 'number', text: 'Client gửi SYN, seq = x' },
    { type: 'number', text: 'Server trả SYN-ACK, seq = y, ack = x + 1' },
    { type: 'number', text: 'Client gửi ACK, ack = y + 1' },
    { type: 'image', attachmentId: n1img },
    { type: 'link', attachmentId: n1link },
    { type: 'check', text: 'Làm bài 3 và 5 trang 112', checked: false, taskId: null },
    { type: 'check', text: 'Đọc lại slide tuần 7', checked: true, taskId: null },
  ),
});
notes[notes.length - 1].plain_text = plain(notes[notes.length - 1].content_json);

const n2 = id();
const n2link = link(n2, 'https://en.wikipedia.org/wiki/Database_normalization', 'Database normalization', 'Chuẩn hóa cơ sở dữ liệu: 1NF, 2NF, 3NF, BCNF.', 'Wikipedia');
notes.push({
  id: n2,
  user_id: uid,
  title: 'CSDL — Chuẩn hóa 1NF → 3NF',
  space: 'study',
  collection_id: C.csdl,
  pinned: false,
  content_json: doc(
    { type: 'h2', text: 'Ghi nhớ' },
    { type: 'bullet', text: '1NF: giá trị nguyên tố, không nhóm lặp' },
    { type: 'bullet', text: '2NF: không phụ thuộc bộ phận vào khóa' },
    { type: 'bullet', text: '3NF: không phụ thuộc bắc cầu' },
    { type: 'link', attachmentId: n2link },
    { type: 'check', text: 'Làm lại đề năm ngoái', checked: false, taskId: null },
  ),
});
notes[notes.length - 1].plain_text = plain(notes[notes.length - 1].content_json);

const n3 = id();
const n3link = link(n3, 'https://developer.mozilla.org/en-US/docs/Web/Accessibility', 'Accessibility | MDN', 'Hướng dẫn trợ năng cho website.', 'MDN Web Docs');
notes.push({
  id: n3,
  user_id: uid,
  title: 'Họp kick-off An Phát',
  space: 'work',
  collection_id: C.web,
  pinned: false,
  content_json: doc(
    { type: 'p', text: 'Khách muốn ra mắt trước Tết. Ưu tiên trang sản phẩm và giỏ hàng.' },
    { type: 'bullet', text: 'Màu chủ đạo xanh lá, font dễ đọc' },
    { type: 'bullet', text: 'Bắt buộc đạt chuẩn trợ năng cơ bản' },
    { type: 'link', attachmentId: n3link },
    { type: 'check', text: 'Gửi 2 phương án banner cho anh Minh', checked: false, taskId: null },
  ),
});
notes[notes.length - 1].plain_text = plain(notes[notes.length - 1].content_json);

const n4 = id();
const n4img = image(n4, chart());
notes.push({
  id: n4,
  user_id: uid,
  title: 'Số liệu báo cáo quý',
  space: 'work',
  collection_id: C.quy,
  pinned: false,
  content_json: doc(
    { type: 'p', text: 'Doanh thu tăng đều 6 tháng, tháng 10 cao nhất.' },
    { type: 'image', attachmentId: n4img },
    { type: 'check', text: 'Xin số liệu chi phí từ kế toán', checked: false, taskId: null },
  ),
});
notes[notes.length - 1].plain_text = plain(notes[notes.length - 1].content_json);

note(
  'Mẹo học nhóm',
  'study',
  null,
  doc({ type: 'p', text: 'Chia việc rõ ràng, họp 15 phút đầu buổi.' }, { type: 'bullet', text: 'Dùng một ghi chú chung cho mỗi buổi' }),
);
const n5 = notes[notes.length - 1].id;
link(n5, 'https://www.notion.so/help/guides', 'Notion guides', 'Mẫu tổ chức tài liệu nhóm.', 'Notion');
notes[notes.length - 1].content_json.blocks.push({ id: 's9', type: 'link', attachmentId: attachments[attachments.length - 1].id });

await must(db.from('notes').insert(notes, { defaultToNull: false }), 'notes');
for (const [path, bytes] of uploads) {
  const { error } = await db.storage.from('attachments').upload(path, bytes, { contentType: 'image/png', upsert: true });
  if (error) console.warn(`Không tải được ảnh ${path}: ${error.message}`);
}
await must(db.from('attachments').insert(attachments, { defaultToNull: false }), 'attachments');
await must(db.from('profiles').update({ onboarding_completed_at: now.toISOString() }).eq('id', uid), 'profile');

console.log(
  `Xong: 4 môn/dự án, 4 buổi học/tuần (+2 ngoại lệ), ${tasks.length} việc (+${subtasks.length} việc con), ${notes.length} ghi chú, ${attachments.length} tệp đính kèm cho ${uid}.`,
);
