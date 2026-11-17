/**
 * Sample media for the browser demo: a hand-drawn-looking whiteboard (SVG, made here), a
 * transcribed lecture with summary, and the rich content of the lecture note.
 * No real audio ships with the demo; the transcript and summary show what Phase 5 produces.
 */
import { docToPlainText, type NoteDoc } from '../../notes/doc';
import type { TranscriptLine, TranscriptSummary } from '../types';

const WHITEBOARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 600">
<rect width="960" height="600" fill="#F4F1EA"/>
<g font-family="Inter,Arial,sans-serif" fill="#1F2937">
<text x="48" y="70" font-size="34" font-weight="700">TCP — bắt tay ba bước</text>
<text x="150" y="140" font-size="24" text-anchor="middle">Client</text>
<text x="810" y="140" font-size="24" text-anchor="middle">Server</text>
</g>
<g stroke="#1F2937" stroke-width="4" stroke-linecap="round">
<line x1="150" y1="160" x2="150" y2="560"/><line x1="810" y1="160" x2="810" y2="560"/>
</g>
<g stroke-width="4" fill="none" stroke-linecap="round">
<path d="M150 210 L800 290" stroke="#2563EB"/><path d="M800 290 l-22 -14 M800 290 l-24 8" stroke="#2563EB"/>
<path d="M810 330 L160 410" stroke="#DC2626"/><path d="M160 410 l22 -14 M160 410 l24 8" stroke="#DC2626"/>
<path d="M150 450 L800 530" stroke="#16A34A"/><path d="M800 530 l-22 -14 M800 530 l-24 8" stroke="#16A34A"/>
</g>
<g font-family="Inter,Arial,sans-serif" font-size="24" font-weight="600">
<text x="420" y="230" fill="#2563EB" transform="rotate(7 420 230)">SYN, seq = x</text>
<text x="340" y="350" fill="#DC2626" transform="rotate(-7 340 350)">SYN-ACK, seq = y, ack = x+1</text>
<text x="420" y="470" fill="#16A34A" transform="rotate(7 420 470)">ACK, ack = y+1</text>
</g>
<text x="48" y="585" font-family="Inter,Arial,sans-serif" font-size="18" fill="#6B7280">Ảnh minh hoạ bảng — bản demo</text>
</svg>`;

export const DEMO_WHITEBOARD = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(WHITEBOARD_SVG)}`;

const LECTURE: [number, string][] = [
  [4, 'Rồi, hôm nay mình học tiếp chương 3, tầng giao vận, cụ thể là TCP.'],
  [19, 'Khác với UDP, TCP là giao thức hướng kết nối và tin cậy: dữ liệu đến đúng thứ tự, không mất, không trùng.'],
  [47, 'Trước khi gửi dữ liệu, hai bên phải bắt tay ba bước. Client gửi SYN với số thứ tự x.'],
  [72, 'Server trả về SYN-ACK, số thứ tự y và ack bằng x cộng một. Cuối cùng client gửi ACK, ack bằng y cộng một.'],
  [118, 'Các em hay nhầm chỗ này: ack là số byte tiếp theo mình mong nhận, không phải số vừa nhận.'],
  [606, 'Phần thứ hai là điều khiển luồng bằng cửa sổ trượt, sliding window.'],
  [640, 'Bên nhận quảng bá kích thước cửa sổ, rwnd, để bên gửi không gửi quá khả năng xử lý.'],
  [702, 'Đừng nhầm điều khiển luồng với điều khiển tắc nghẽn: một bên là bảo vệ người nhận, một bên là bảo vệ mạng.'],
  [1210, 'Điều khiển tắc nghẽn có slow start: cwnd tăng gấp đôi mỗi RTT cho tới ngưỡng ssthresh.'],
  [1265, 'Khi mất gói, TCP Reno giảm cwnd một nửa, gọi là AIMD, tăng cộng giảm nhân.'],
  [1820, 'Đóng kết nối thì dùng bốn bước với cờ FIN, và có trạng thái TIME_WAIT để chờ gói trễ.'],
  [2380, 'Bài tập về nhà: làm bài 3 và bài 5 trang 112, nộp trên Moodle trước thứ sáu tuần sau.'],
  [2402, 'Buổi sau kiểm tra 15 phút phần bắt tay ba bước, các em đọc lại slide tuần này nhé.'],
  [2650, 'Ai còn thắc mắc về lab định tuyến thì ở lại hỏi thầy. Hết giờ.'],
];

export const DEMO_SEGMENT_SEC = 600;
export const DEMO_DURATION_SEC = 2710;

/** Lines grouped into the 10-minute segments they would have come from. */
export function demoSegments(): { seq: number; start: number; duration: number; lines: TranscriptLine[] }[] {
  const count = Math.ceil(DEMO_DURATION_SEC / DEMO_SEGMENT_SEC);
  return Array.from({ length: count }, (_, seq) => {
    const start = seq * DEMO_SEGMENT_SEC;
    const duration = Math.min(DEMO_SEGMENT_SEC, DEMO_DURATION_SEC - start);
    return { seq, start, duration, lines: LECTURE.filter(([t]) => t >= start && t < start + duration).map(([t, text]) => ({ t, text })) };
  });
}

export const DEMO_SUMMARY: TranscriptSummary = {
  main_points: [
    'TCP là giao thức hướng kết nối, tin cậy: dữ liệu đến đủ, đúng thứ tự, không trùng.',
    'Bắt tay ba bước SYN → SYN-ACK → ACK; ack là số byte tiếp theo mong nhận.',
    'Điều khiển luồng (cửa sổ trượt, rwnd) bảo vệ bên nhận; điều khiển tắc nghẽn bảo vệ mạng.',
    'Slow start tăng cwnd gấp đôi mỗi RTT tới ssthresh; khi mất gói TCP Reno giảm một nửa (AIMD).',
    'Đóng kết nối bằng bốn bước FIN, có trạng thái TIME_WAIT.',
  ],
  key_terms: [
    { term: 'SYN / ACK', explanation: 'Cờ trong tiêu đề TCP để mở kết nối và xác nhận dữ liệu đã nhận.' },
    { term: 'rwnd', explanation: 'Cửa sổ nhận do bên nhận quảng bá, giới hạn lượng dữ liệu chưa xác nhận.' },
    { term: 'cwnd / ssthresh', explanation: 'Cửa sổ tắc nghẽn và ngưỡng chuyển từ slow start sang tăng tuyến tính.' },
    { term: 'TIME_WAIT', explanation: 'Trạng thái chờ sau khi đóng để gói trễ không lẫn vào kết nối mới.' },
  ],
  homework: [
    { title: 'Làm bài 3 và bài 5 trang 112, nộp trên Moodle', deadline_hint: 'thứ sáu tuần sau' },
    { title: 'Đọc lại slide tuần này để kiểm tra 15 phút', deadline_hint: 'buổi sau' },
  ],
};

export function demoTranscriptText(): string {
  return LECTURE.map(([t, text]) => `[${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}] ${text}`).join(
    '\n',
  );
}

export function lectureDoc(ids: { image: string; link: string; audio: string }): { doc: NoteDoc; plain: string } {
  let n = 0;
  const b = () => `seed${++n}`;
  const doc: NoteDoc = {
    type: 'doc',
    version: 1,
    blocks: [
      { id: b(), type: 'h1', text: 'Chương 3 — TCP' },
      { id: b(), type: 'p', text: 'Thầy nhấn mạnh: **ack = số byte tiếp theo mong nhận**, _không phải_ số vừa nhận.' },
      { id: b(), type: 'audio', attachmentId: ids.audio },
      { id: b(), type: 'h2', text: 'Bắt tay ba bước' },
      { id: b(), type: 'number', text: 'Client gửi **SYN**, seq = x' },
      { id: b(), type: 'number', text: 'Server trả **SYN-ACK**, seq = y, ack = x + 1' },
      { id: b(), type: 'number', text: 'Client gửi **ACK**, ack = y + 1' },
      { id: b(), type: 'image', attachmentId: ids.image },
      { id: b(), type: 'h2', text: 'Cửa sổ trượt' },
      { id: b(), type: 'bullet', text: 'Điều khiển luồng: bảo vệ _bên nhận_ (rwnd)' },
      { id: b(), type: 'bullet', text: 'Điều khiển tắc nghẽn: bảo vệ _mạng_ (cwnd, slow start)' },
      { id: b(), type: 'link', attachmentId: ids.link },
      { id: b(), type: 'check', text: 'Làm bài tập 3 trang 112', checked: false, taskId: null },
      { id: b(), type: 'check', text: 'Đọc slide tuần 5', checked: true, taskId: null },
      { id: b(), type: 'check', text: 'Hỏi thầy về bài lab định tuyến', checked: false, taskId: null },
    ],
  };
  return { doc, plain: docToPlainText(doc) };
}
