/**
 * Vietnamese strings used by the shared planning core (server + app).
 * src/i18n/vi.ts spreads these, so there is still a single source for every string.
 */
export const viCore = {
  weekdays: ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'] as const,
  weekdaysShort: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] as const,

  duration: {
    minutes: (m: number) => `${m} phút`,
    hours: (h: number) => `${h} giờ`,
    /** Compact form used in capacity bars: 5g20, 6g, 40p. */
    compact: (h: number, m: number) => (h === 0 ? `${m}p` : m === 0 ? `${h}g` : `${h}g${String(m).padStart(2, '0')}`),
  },

  countdown: {
    overdue: (d: number) => (d <= 0 ? 'Quá hạn' : `Quá hạn ${d} ngày`),
    today: 'Hôm nay',
    tomorrow: 'Ngày mai',
    days: (d: number) => `còn ${d} ngày`,
    hours: (h: number) => `còn ${h} giờ`,
  },

  space: { study: 'Học tập', work: 'Công việc' },

  priorityReason: {
    overdue: 'Đã quá hạn',
    dueToday: 'Hạn hôm nay',
    dueTomorrow: 'Hạn ngày mai',
    dueSoon: (d: number) => `Hạn trong ${d} ngày`,
    tightTime: (h: string) => `Còn ${h} cần làm, thời gian sát`,
    highPriority: 'Ưu tiên cao',
    noDeadline: 'Không có hạn',
    join: ' · ',
  },

  plan: {
    issue: {
      unknown_task: 'Khối gắn với việc không tồn tại',
      invalid_range: 'Giờ bắt đầu/kết thúc không hợp lệ',
      too_long: 'Khối dài hơn 90 phút',
      too_short: 'Khối quá ngắn',
      outside_window: 'Nằm ngoài khung giờ cho phép',
      overlap: 'Trùng lịch bận, lớp học hoặc khối khác',
      after_deadline: 'Kết thúc sau hạn chót',
      exceeds_remaining: 'Vượt quá thời lượng còn lại của việc',
      over_capacity: 'Vượt sức chứa của ngày',
      too_many_consecutive: 'Quá 3 giờ tập trung liên tục',
    },
    warning: {
      cannotFit: (title: string, shortfall: string) => `Không đủ thời gian cho '${title}' trước hạn — cần thêm ${shortfall}`,
      partial: (title: string, left: string) => `'${title}' còn ${left} chưa xếp được`,
      overload: (day: string, space: string, amount: string) => `${day}: ${space} quá tải ${amount}`,
      dropped: (title: string) => `Đã bỏ một khối của '${title}' vì không tìm được giờ hợp lệ`,
      repaired: (title: string) => `Đã dời một khối của '${title}' sang giờ hợp lệ gần nhất`,
      aiUnavailable: 'AI tạm thời không phản hồi — đây là lịch do Nhịp tự xếp theo quy tắc.',
    },
    summaryFallback: (blocks: number, tasks: number) =>
      blocks === 0
        ? 'Không còn khung giờ trống phù hợp trong khoảng này.'
        : `Đã xếp ${blocks} khối cho ${tasks} việc theo hạn chót và ưu tiên.`,
    reasonTopUp: 'Tự bổ sung vào khung giờ trống gần nhất',
    reasonGreedy: (why: string) => `${why} · khung giờ trống sớm nhất`,
  },
} as const;
