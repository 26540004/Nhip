/** The "Hướng dẫn nhanh" note created at the end of onboarding (pure, tested). */
import { docToPlainText, type NoteDoc, type TextBlock } from '../../lib/notes/doc';

export const QUICK_START_TITLE = 'Hướng dẫn nhanh';

export function quickStartDoc(): { doc: NoteDoc; plain: string } {
  let n = 0;
  const b = (type: TextBlock['type'], text: string): TextBlock => ({
    id: `qs${++n}`,
    type,
    text,
    ...(type === 'check' ? { checked: false, taskId: null } : {}),
  });
  const doc: NoteDoc = {
    type: 'doc',
    version: 1,
    blocks: [
      b('p', 'Nhịp giúp bạn ghi chú, quản lý việc và để AI **đề xuất** lịch — bạn duyệt trước khi lịch lên Google Calendar.'),
      b('h2', 'Thêm việc thật nhanh'),
      b('bullet', 'Bấm **＋** (trên web: phím **N**) rồi gõ tự nhiên, vd. _nộp báo cáo mạng thứ 6 tuần sau khoảng 3 tiếng_.'),
      b('bullet', 'AI tách việc; hạn chót và thời lượng do Nhịp tự tính chính xác. Chip vàng = Nhịp chưa chắc là Học hay Việc.'),
      b('h2', 'Xếp lịch'),
      b('bullet', 'Ở **Hôm nay**, bấm **✦ AI xếp lịch**, xem đề xuất, sửa giờ nếu cần rồi bấm Đồng ý.'),
      b('bullet', 'Việc Công việc chỉ nằm trong giờ hành chính (trừ nghỉ trưa); việc Học tập không trùng giờ lên lớp.'),
      b('bullet', 'Ngày quá tải sẽ hiện màu đỏ và nút **Cân bằng lại**.'),
      b('h2', 'Ghi chú & ghi âm'),
      b('bullet', 'Bấm 🎙 để ghi âm bài giảng — khóa màn hình vẫn ghi. Sau đó chọn **✦ Phiên âm & tóm tắt**.'),
      b('bullet', 'Dòng checklist có nút **Chuyển thành việc**. Nút ✦ AI tóm tắt ghi chú hoặc tìm việc cần làm.'),
      b('h2', 'Thử ngay'),
      b('check', 'Thêm việc đầu tiên bằng nút ＋'),
      b('check', 'Bấm ✦ AI xếp lịch ở Hôm nay'),
      b('check', 'Ghi âm thử 10 giây trong một ghi chú'),
      b('p', '_Chỉnh giờ hành chính, thời khóa biểu, khung giờ học và sức chứa trong Cài đặt (ảnh đại diện ở Hôm nay)._'),
    ],
  };
  return { doc, plain: docToPlainText(doc) };
}
