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
    googleEvent: 'Sự kiện Google',
    sync: { ok: 'Đã đồng bộ', syncing: 'Đang đồng bộ', error: 'Lỗi đồng bộ — chạm để sửa' },
  },

  aiMarker: '✦ AI',

  common: {
    close: 'Đóng',
    notFound: 'Không tìm thấy trang này',
    save: 'Lưu',
    cancel: 'Hủy',
    delete: 'Xóa',
    edit: 'Sửa',
    add: 'Thêm',
    done: 'Xong',
    none: 'Không',
    back: 'Quay lại',
    saved: 'Đã lưu',
    saving: 'Đang lưu…',
    confirmDelete: 'Xóa mục này? Không thể hoàn tác.',
    moveUp: 'Chuyển lên',
    moveDown: 'Chuyển xuống',
  },

  errors: {
    offline: 'Cần kết nối mạng',
    network: 'Không kết nối được máy chủ. Thử lại nhé.',
    unauthorized: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.',
    ai_unavailable: 'AI tạm thời không phản hồi.',
    ai_quota: 'Đã hết lượt AI hôm nay.',
    privacy_mode: 'Đang bật chế độ riêng tư — tính năng này tắt.',
    auth_failed: 'Đăng nhập không thành công. Thử lại nhé.',
    auth_cancelled: 'Đã hủy đăng nhập.',
    bad_request: 'Dữ liệu không hợp lệ.',
    internal: 'Có lỗi xảy ra. Thử lại nhé.',
  } as Record<string, string>,

  auth: {
    tagline: 'Ghi chú, việc và lịch — AI đề xuất, bạn quyết định.',
    apple: 'Đăng nhập với Apple',
    google: 'Đăng nhập với Google',
    signOut: 'Đăng xuất',
    notConfigured: 'Chưa cấu hình Supabase',
    notConfiguredBody: 'Đặt EXPO_PUBLIC_SUPABASE_URL và EXPO_PUBLIC_SUPABASE_ANON_KEY trong .env rồi khởi động lại (xem README).',
  },

  quickAdd: {
    title: 'Thêm nhanh',
    placeholder: 'Ví dụ: thứ 6 nộp báo cáo môn Mạng, mất khoảng 3 tiếng',
    analyze: 'Phân tích',
    analyzing: 'Đang phân tích…',
    save: 'Lưu',
    saveAndPlan: 'Lưu & xếp lịch',
    fullForm: 'Mở form đầy đủ',
    saveRaw: 'Lưu vào hộp việc',
    unparsedTag: 'Chưa phân tích',
    aiFailed: 'AI chưa phân tích được — bạn có thể lưu nguyên câu vào hộp việc và thử lại sau.',
    savedCount: (n: number) => (n === 1 ? 'Đã lưu 1 việc' : `Đã lưu ${n} việc`),
    checkSpace: 'Kiểm tra lại: Học hay Việc?',
    subtasks: (n: number) => `${n} việc con gợi ý`,
    remove: 'Bỏ việc này',
    noDeadline: 'Không hạn',
    noEstimate: 'Chưa ước tính',
    noCollection: 'Chưa chọn',
    link: 'Liên kết',
    planLater: 'Xếp lịch bằng AI có ở giai đoạn 3 — việc đã được lưu.',
    mic: 'Nhập bằng giọng nói',
  },

  tasks: {
    groups: {
      overdue: 'Quá hạn',
      today: 'Hôm nay',
      week: 'Tuần này',
      later: 'Sau đó',
      noDeadline: 'Không có hạn',
      done: 'Đã xong',
    },
    empty: 'Chưa có việc nào. Gõ ＋ để thêm.',
    emptyFiltered: 'Không có việc nào khớp bộ lọc.',
    sort: { deadline: 'Hạn chót', priority: 'Ưu tiên' },
    filterAllCollections: 'Mọi môn/dự án',
    scheduled: 'Đã xếp lịch',
    newTask: 'Việc mới',
    fields: {
      title: 'Tên việc',
      description: 'Mô tả',
      space: 'Không gian',
      collection: 'Môn học / dự án',
      deadline: 'Hạn chót',
      estimate: 'Ước tính',
      priority: 'Ưu tiên',
      subtasks: 'Việc con',
      links: 'Liên kết',
      blocks: 'Khối đã xếp',
      actual: 'Thời gian thực tế',
    },
    deadlineInputHint: 'dd/mm hh:mm hoặc "thứ 6", "mai 17h"',
    deadlineInvalid: 'Không hiểu ngày giờ này',
    estimateOptions: [15, 30, 45, 60, 90, 120, 180, 240] as number[],
    addSubtask: 'Thêm việc con',
    subtaskPlaceholder: 'Tên việc con',
    deleteTask: 'Xóa việc',
    markDone: 'Đánh dấu xong',
    markTodo: 'Đánh dấu chưa xong',
    unparsedRetry: 'Phân tích lại bằng AI',
    noBlocks: 'Chưa có khối nào trên lịch.',
    aiReason: 'Lý do',
    blockStatus: { accepted: 'Đã chấp nhận', synced: 'Đã đồng bộ', conflict: 'Xung đột', proposed: 'Đề xuất', rejected: 'Đã bỏ' } as Record<
      string,
      string
    >,
    quickDeadline: { today: 'Hôm nay', tomorrow: 'Mai', friday: 'Thứ 6', nextWeek: 'Tuần sau', clear: 'Bỏ hạn' },
  },

  notes: {
    empty: 'Chưa có ghi chú nào.',
    newNote: 'Ghi chú mới',
    titlePlaceholder: 'Tiêu đề',
    bodyPlaceholder: 'Viết gì đó… Dòng bắt đầu bằng "[ ]" là checklist.',
    pinned: 'Đã ghim',
    pin: 'Ghim',
    unpin: 'Bỏ ghim',
    deleteNote: 'Xóa ghi chú',
    toTask: 'Chuyển thành việc',
    convertedToTask: 'Đã tạo việc từ dòng này',
    untitled: 'Không tiêu đề',
    richEditorLater: 'Định dạng, ảnh và ghi âm có ở giai đoạn 5.',
    checklist: 'Checklist',
  },

  search: {
    placeholder: 'Tìm việc, ghi chú, bản ghi âm…',
    empty: 'Không tìm thấy kết quả.',
    hint: 'Gõ ít nhất 2 ký tự. Không cần dấu.',
    kinds: { task: 'Việc', note: 'Ghi chú', transcript: 'Ghi âm' } as Record<string, string>,
  },

  collections: {
    title: 'Môn học & dự án',
    subjects: 'Môn học',
    projects: 'Dự án',
    addSubject: 'Thêm môn học',
    addProject: 'Thêm dự án',
    namePlaceholder: 'Tên',
    archive: 'Lưu trữ',
    unarchive: 'Bỏ lưu trữ',
    empty: 'Chưa có.',
  },

  settings: {
    account: 'Tài khoản',
    signedInAs: (email: string) => `Đăng nhập: ${email}`,
    aiUsage: (n: number) => `Lượt AI hôm nay: ${n}`,
    privacy: 'Không gửi nội dung ghi chú cho AI',
    privacyHelp: 'Khi bật, AI chỉ nhận tiêu đề, thời lượng, hạn chót và giờ. Chuyển giọng nói thành chữ và tóm tắt ghi chú sẽ tắt.',
    moreLater: 'Google Calendar, giờ hành chính, thời khóa biểu và nhắc nhở có ở các giai đoạn tiếp theo.',
  },

  comingSoon: {
    // Shown only on screens whose feature belongs to a later build phase.
    title: 'Đang xây dựng',
    body: 'Màn hình này sẽ có trong giai đoạn tiếp theo.',
  },
} as const;

export type Vi = typeof vi;
