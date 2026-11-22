/**
 * Demo data: a working student with 2 subjects, 2 projects, a weekly timetable, office
 * hours, tasks with varied deadlines, notes and a few Google events — all relative to "now"
 * so the demo always looks current.
 */
import * as Crypto from 'expo-crypto';
import { addDaysToKey, APP_TZ, dateKeyOf, localToInstant, weekdayOfKey } from '../../time/tz';
import { DEMO_UID, type Row, type Tables } from './demoDb';
import { DEMO_DURATION_SEC, DEMO_SUMMARY, demoSegments, demoTranscriptText, lectureDoc } from './seedMedia';

const id = () => Crypto.randomUUID();

const iso = (t: number) => new Date(t).toISOString();

export function seedDemo(now: number = Date.now()): Tables {
  const tz = APP_TZ;
  const today = dateKeyOf(now, tz);
  const at = (dayOffset: number, hhmm: string) => localToInstant(addDaysToKey(today, dayOffset), hhmm, tz);
  const created = iso(now - 5 * 86_400_000);
  const base = { user_id: DEMO_UID, created_at: created, updated_at: created };

  // Next weekday with the given index (0 = Sunday), counting today.
  const nextWeekday = (wd: number) => (wd - weekdayOfKey(today) + 7) % 7;

  const mang = id();
  const csdl = id();
  const web = id();
  const noiBo = id();
  const collections: Row[] = [
    { ...base, id: mang, space: 'study', kind: 'subject', name: 'Mạng máy tính', color_variant: 0, archived: false },
    { ...base, id: csdl, space: 'study', kind: 'subject', name: 'Cơ sở dữ liệu', color_variant: 1, archived: false },
    { ...base, id: web, space: 'work', kind: 'project', name: 'Website Kim Long', color_variant: 0, archived: false },
    { ...base, id: noiBo, space: 'work', kind: 'project', name: 'Báo cáo nội bộ', color_variant: 1, archived: false },
  ];

  const work_hours: Row[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    user_id: DEMO_UID,
    weekday,
    start_time: '08:00:00',
    end_time: '17:00:00',
    break_start: '12:00:00',
    break_end: '13:00:00',
    enabled: weekday >= 1 && weekday <= 5,
  }));
  const study_windows: Row[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    id: id(),
    user_id: DEMO_UID,
    weekday,
    start_time: weekday === 0 || weekday === 6 ? '08:00:00' : '19:00:00',
    end_time: weekday === 0 || weekday === 6 ? '22:00:00' : '22:30:00',
  }));
  const capacity_settings: Row[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    capacity_settings.push({ user_id: DEMO_UID, space: 'work', weekday, max_focus_minutes: weekday >= 1 && weekday <= 5 ? 360 : 0 });
    capacity_settings.push({ user_id: DEMO_UID, space: 'study', weekday, max_focus_minutes: weekday >= 1 && weekday <= 5 ? 150 : 300 });
  }
  const class_sessions: Row[] = [
    {
      id: id(),
      user_id: DEMO_UID,
      collection_id: mang,
      weekday: 2,
      start_time: '18:00:00',
      end_time: '20:30:00',
      location: 'B4.12',
      valid_from: null,
      valid_to: null,
    },
    {
      id: id(),
      user_id: DEMO_UID,
      collection_id: csdl,
      weekday: 4,
      start_time: '18:00:00',
      end_time: '20:30:00',
      location: 'C2.05',
      valid_from: null,
      valid_to: null,
    },
    {
      id: id(),
      user_id: DEMO_UID,
      collection_id: csdl,
      weekday: 6,
      start_time: '08:00:00',
      end_time: '11:00:00',
      location: 'C2.05',
      valid_from: null,
      valid_to: null,
    },
  ];

  const tasks: Row[] = [];
  const t = (p: Partial<Row> & { title: string; space: 'study' | 'work' }) => {
    const row: Row = {
      ...base,
      id: id(),
      collection_id: null,
      parent_task_id: null,
      description: null,
      deadline_at: null,
      estimate_minutes: 60,
      priority: 2,
      priority_reason: null,
      status: 'todo',
      source: 'form',
      source_note_id: null,
      needs_parse: false,
      sort_order: 0,
      completed_at: null,
      actual_minutes: null,
      ...p,
    };
    tasks.push(row);
    return row.id as string;
  };

  const baoCao = t({
    title: 'Báo cáo môn Mạng',
    space: 'study',
    collection_id: mang,
    deadline_at: iso(at(nextWeekday(5) || 7, '23:59')),
    estimate_minutes: 180,
    priority: 1,
    priority_reason: 'Hạn thứ 6, khối lượng lớn',
    source: 'quick_add',
  });
  t({ title: 'Tìm tài liệu định tuyến', space: 'study', collection_id: mang, parent_task_id: baoCao, estimate_minutes: 60, sort_order: 0 });
  t({ title: 'Viết phần lý thuyết', space: 'study', collection_id: mang, parent_task_id: baoCao, estimate_minutes: 90, sort_order: 1 });
  t({ title: 'Rà soát & nộp', space: 'study', collection_id: mang, parent_task_id: baoCao, estimate_minutes: 30, sort_order: 2 });
  t({
    title: 'Ôn thi giữa kỳ CSDL',
    space: 'study',
    collection_id: csdl,
    deadline_at: iso(at(9, '08:00')),
    estimate_minutes: 240,
    priority: 1,
  });
  t({ title: 'Bài tập SQL tuần 6', space: 'study', collection_id: csdl, deadline_at: iso(at(2, '23:59')), estimate_minutes: 90 });
  t({ title: 'Đọc chương 4 giáo trình Mạng', space: 'study', collection_id: mang, estimate_minutes: 45, priority: 3 });
  t({
    title: 'Sửa banner trang chủ',
    space: 'work',
    collection_id: web,
    deadline_at: iso(at(1, '17:00')),
    estimate_minutes: 90,
    priority: 1,
    priority_reason: 'Khách cần trước 5h chiều mai',
  });
  t({ title: 'Gửi báo giá cho anh Minh', space: 'work', deadline_at: iso(at(-1, '17:00')), estimate_minutes: 30 });
  const hop = t({ title: 'Họp team tuần', space: 'work', collection_id: noiBo, deadline_at: iso(at(0, '23:59')), estimate_minutes: 60 });
  t({
    title: 'Tổng hợp số liệu tháng',
    space: 'work',
    collection_id: noiBo,
    deadline_at: iso(at(4, '17:00')),
    estimate_minutes: 150,
    priority: 2,
  });
  t({ title: 'Cập nhật hợp đồng mẫu', space: 'work', status: 'done', completed_at: iso(now - 3_600_000), estimate_minutes: 30 });
  t({ title: 'mua quà sinh nhật mẹ cuối tuần', space: 'work', source: 'quick_add', needs_parse: true, estimate_minutes: null });
  t({ title: 'Đăng ký học phần kỳ sau', space: 'study', deadline_at: iso(at(12, '23:59')), estimate_minutes: 30, priority: 2 });

  // One synced block today (inside office hours when possible).
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));
  const startHour = Math.min(Math.max(hour + 1, 9), 15);
  const task_blocks: Row[] = [
    {
      ...base,
      id: id(),
      task_id: hop,
      start_at: iso(at(0, `${String(startHour).padStart(2, '0')}:00`)),
      end_at: iso(at(0, `${String(startHour + 1).padStart(2, '0')}:00`)),
      status: 'synced',
      proposal_id: null,
      reason: null,
      gcal_event_id: null,
      gcal_calendar_id: null,
      gcal_etag: null,
      last_synced_at: iso(now),
    },
  ];

  const note = (title: string, text: string, space: 'study' | 'work', collection_id: string | null, pinned = false) => {
    const nid = id();
    notes.push({ ...base, id: nid, space, collection_id, title, plain_text: text, content_json: { type: 'plain', text }, pinned });
    return nid;
  };
  const notes: Row[] = [];
  // The lecture note shows Phase 5: rich text, a whiteboard photo, a link card and a
  // transcribed recording with its summary.
  const n1 = id();
  const imageId = id();
  const linkId = id();
  const audioId = id();
  const lecture = lectureDoc({ image: imageId, link: linkId, audio: audioId });
  notes.push({
    ...base,
    id: n1,
    space: 'study',
    collection_id: mang,
    title: 'Bài giảng TCP/IP – tuần 5',
    plain_text: lecture.plain,
    content_json: lecture.doc,
    pinned: true,
  });
  note('Ý tưởng banner', 'Màu chủ đạo xanh lá, thêm ảnh sản phẩm mới, CTA "Đặt hàng ngay".\n[ ] Gửi 2 phương án cho anh Minh', 'work', web);
  note('Ôn CSDL', 'Chuẩn hóa 1NF → 3NF, khóa ngoại, JOIN các loại.\n[ ] Làm lại đề năm ngoái', 'study', csdl);
  note('Việc cá nhân', 'Gia hạn thẻ thư viện\nĐặt lịch khám răng', 'work', null);

  const segs = demoSegments();
  const attachments: Row[] = [
    {
      ...base,
      id: linkId,
      owner_type: 'note',
      owner_id: n1,
      type: 'link',
      url: 'https://www.rfc-editor.org/rfc/rfc9293',
      title: 'RFC 9293: Transmission Control Protocol (TCP)',
      storage_path: null,
      meta_json: { description: 'Đặc tả chuẩn của TCP (2022), thay thế RFC 793.', image: null, site_name: 'RFC Editor', preview: 'ok' },
    },
    {
      ...base,
      id: imageId,
      owner_type: 'note',
      owner_id: n1,
      type: 'image',
      storage_path: `${DEMO_UID}/demo-whiteboard.svg`,
      meta_json: { width: 960, height: 600, thumb_path: `${DEMO_UID}/demo-whiteboard.svg` },
    },
    {
      ...base,
      id: audioId,
      owner_type: 'note',
      owner_id: n1,
      type: 'audio',
      title: 'Ghi âm buổi học tuần 5',
      storage_path: `${DEMO_UID}/${audioId}/seg-000.m4a`,
      duration_sec: DEMO_DURATION_SEC,
      bookmarks_json: [{ at_sec: 72 }, { at_sec: 1210 }, { at_sec: 2380 }],
      meta_json: { recording: 'done', segment_count: segs.length, mime: 'audio/mp4' },
      transcript_status: 'done',
      transcript_text: demoTranscriptText(),
      summary_json: DEMO_SUMMARY,
      // Transcribed 2 days ago → audio auto-deletes in 12 days.
      audio_expires_at: new Date(now + 12 * 86_400_000 + 5 * 3_600_000).toISOString(),
      audio_deleted_at: null,
    },
  ];
  const audio_segments: Row[] = segs.map((sg) => ({
    ...base,
    id: id(),
    attachment_id: audioId,
    seq: sg.seq,
    storage_path: `${DEMO_UID}/${audioId}/seg-${String(sg.seq).padStart(3, '0')}.m4a`,
    mime: 'audio/mp4',
    start_offset_sec: sg.start,
    duration_sec: sg.duration,
    uploaded: true,
    transcript_status: 'done',
    transcript_json: sg.lines,
    last_error: null,
    attempts: 1,
  }));

  // Google events (read-only) so the timeline/calendar show grey busy blocks.
  const busy_cache: Row[] = [
    {
      id: id(),
      user_id: DEMO_UID,
      source_calendar_id: 'primary',
      gcal_event_id: 'g1',
      start_at: iso(at(1, '10:00')),
      end_at: iso(at(1, '11:00')),
      title: 'Gặp khách hàng Kim Long',
      all_day: false,
      updated_at: iso(now),
    },
    {
      id: id(),
      user_id: DEMO_UID,
      source_calendar_id: 'primary',
      gcal_event_id: 'g2',
      start_at: iso(at(2, '20:00')),
      end_at: iso(at(2, '21:30')),
      title: 'Sinh hoạt CLB',
      all_day: false,
      updated_at: iso(now),
    },
    {
      id: id(),
      user_id: DEMO_UID,
      source_calendar_id: 'primary',
      gcal_event_id: 'g3',
      start_at: iso(at(3, '12:30')),
      end_at: iso(at(3, '13:00')),
      title: 'Ăn trưa với Lan',
      all_day: false,
      updated_at: iso(now),
    },
  ];

  return {
    profiles: [
      {
        id: DEMO_UID,
        display_name: 'Bạn',
        timezone: tz,
        ai_privacy_mode: false,
        daily_ai_calls: 0,
        daily_ai_calls_date: today,
        onboarding_completed_at: iso(now),
        created_at: created,
        updated_at: created,
      },
    ],
    collections,
    work_hours,
    study_windows,
    capacity_settings,
    class_sessions,
    schedule_exceptions: [],
    reminder_settings: [
      {
        user_id: DEMO_UID,
        morning_brief_time: '07:00:00',
        evening_review_time: '21:30:00',
        morning_brief_enabled: true,
        evening_review_enabled: true,
        deadline_offsets_minutes: [10080, 1440],
        start_offset_minutes: 10,
        quiet_start: '23:00:00',
        quiet_end: '06:30:00',
      },
    ],
    tasks,
    task_blocks,
    notes,
    attachments,
    audio_segments,
    busy_cache,
    ai_proposals: [],
    google_connections: [],
    push_tokens: [],
    notification_log: [],
  };
}
