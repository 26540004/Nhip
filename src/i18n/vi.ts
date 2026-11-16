/**
 * All user-visible Vietnamese strings. Nothing user-facing is hardcoded elsewhere.
 * Functions are used where a string needs values.
 */
export const vi = {
  appName: 'Nhịp',

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

  tabs: {
    today: 'Hôm nay',
    tasks: 'Việc',
    add: 'Thêm',
    notes: 'Ghi chú',
    calendar: 'Lịch',
    settings: 'Cài đặt',
  },

  spaceFilter: { all: 'Tất cả', study: 'Học', work: 'Việc' },
  space: { study: 'Học tập', work: 'Công việc' },

  priority: {
    1: 'Cao',
    2: 'Vừa',
    3: 'Thấp',
  } as Record<1 | 2 | 3, string>,

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

  capacity: {
    label: (space: string, used: string, max: string) => `${space} ${used} / ${max}`,
    over: (amount: string) => `Quá tải ${amount}`,
    near: 'Gần đầy',
    rebalance: 'Cân bằng lại',
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
    },
  },

  notifications: {
    blockStartTitle: (title: string) => `Sắp bắt đầu: ${title}`,
    blockStartBody: (range: string, minutes: number) => `${range} · còn ${minutes} phút`,
    actionStart: 'Bắt đầu',
    actionSnooze: 'Hoãn 15 phút',
  },

  states: {
    loading: 'Đang tải…',
    error: 'Có lỗi xảy ra. Thử lại nhé.',
    retry: 'Thử lại',
    offline: 'Đang ngoại tuyến — hiển thị dữ liệu đã lưu',
    needNetwork: 'Cần kết nối mạng',
    pendingSync: 'Chờ đồng bộ',
  },

  today: {
    empty: 'Hôm nay trống. Gõ ＋ để thêm việc đầu tiên.',
    unscheduled: 'Chưa xếp lịch',
    aiPlan: '✦ AI xếp lịch',
    classTag: 'Lớp',
    sync: { ok: 'Đã đồng bộ', syncing: 'Đang đồng bộ', error: 'Lỗi đồng bộ — chạm để sửa' },
  },

  aiMarker: '✦ AI',

  common: {
    close: 'Đóng',
    notFound: 'Không tìm thấy trang này',
  },

  comingSoon: {
    // Shown only on screens whose feature belongs to a later build phase.
    title: 'Đang xây dựng',
    body: 'Màn hình này sẽ có trong giai đoạn tiếp theo.',
  },
} as const;

export type Vi = typeof vi;
