# Nhịp — Ghi chú, Việc & Lịch có AI hỗ trợ

Ứng dụng năng suất cá nhân (iPhone + Web) cho người vừa học vừa làm: ghi chú, danh sách việc và lịch, với AI **đề xuất** lịch để bạn **duyệt** trước khi ghi vào Google Calendar.

- **Học tập**: theo môn học — bài tập, kỳ thi, ghi chú, ghi âm bài giảng.
- **Công việc**: theo dự án — chỉ xếp trong giờ hành chính.

Ba vấn đề cốt lõi: dồn quá nhiều việc vào một ngày → giới hạn sức chứa + cảnh báo quá tải; quên hạn chót → lập kế hoạch ngược + nhắc nhiều mốc; không biết ưu tiên gì → xếp hạng ưu tiên minh bạch kèm lý do một dòng.

---

## Tiến độ theo giai đoạn

| Giai đoạn | Nội dung | Trạng thái |
|---|---|---|
| **1. Nền móng** | Expo + Router + TypeScript strict, design tokens, i18n tiếng Việt, điều hướng (tab bar điện thoại / sidebar desktop, phím tắt), toàn bộ schema Supabase + RLS + tìm kiếm + pg_cron, thư viện thuần đã kiểm thử: `slots`, `capacity`, `priority`, `validatePlan`, `greedyPlan`, bộ lập lịch thông báo cục bộ | ✅ Xong |
| **2. Dữ liệu & Việc** | Đăng nhập Apple/Google, truy vấn có kiểu + hàng đợi ghi offline, Việc (nhóm, lọc, chi tiết, việc con, liên kết), Ghi chú (danh sách, soạn thảo tự lưu, checklist → việc), Hôm nay dùng dữ liệu thật, Tìm kiếm, Môn học & dự án, Quick Add + Edge Function `parse-task` (Gemini → Groq), 34 fixture ngày giờ tiếng Việt | ✅ Xong |
| **3. Lịch & AI xếp lịch** | `gcal-auth` (OAuth, Vault, lịch riêng "Nhịp"), `gcal-sync` (2 chiều, syncToken, 410, thu hồi quyền), `propose-plan` (AI đề xuất → code kiểm tra/sửa/bổ sung, dự phòng không AI, Cân bằng lại, Xếp lịch việc này), màn duyệt đề xuất + Hoàn tác 10 s, màn Lịch Ngày/3 ngày/Tuần với kéo thả và "Đổi giờ", cài đặt Google | ✅ Xong |
| **4. Nhắc nhở** | Nhắc trước giờ bắt đầu khối (thông báo cục bộ, tối đa 50, nút "Bắt đầu" / "Hoãn 15 phút"), đăng ký push token, `push-dispatch` (tóm tắt sáng, tổng kết tối, nhắc hạn chót, giờ yên lặng, chống gửi trùng), màn `/brief`, `/review`, thẻ tóm tắt trên Hôm nay, Cài đặt → Nhắc nhở | ✅ Xong |
| **5. Ghi âm & Ghi chú giàu nội dung** | Trình soạn thảo khối (tiêu đề, đậm/nghiêng, danh sách, checklist → việc), ảnh (nén 1920 px, thumbnail, xem phóng to), thẻ liên kết (`link-preview`, chống SSRF), ghi âm nền chia đoạn 10 phút + tải lên nền + phát lại có đánh dấu, `transcribe-audio` (từng đoạn, thử lại, tóm tắt, bài tập → việc), `note-ai` (tóm tắt ghi chú, tìm việc), ảnh & ghi âm trong chi tiết việc | ✅ Xong |
| **6. Hoàn thiện** | Onboarding 5 bước, Cài đặt đầy đủ (giờ hành chính, thời khóa biểu + ngoại lệ, khung giờ học, sức chứa, dữ liệu), xuất dữ liệu .zip, "✦ Chia nhỏ việc này" (`split-task`), script seed, icon riêng, rà soát giao diện/trợ năng/ngoại tuyến, QA lập lịch trên dữ liệu seed | ✅ Xong (còn QA trên iPhone thật — xem mục "Đã kiểm chứng") |
| **7. Nhịp hiểu về bạn** | Hồ sơ thói quen (tỉ lệ thời gian thật/dự kiến, giờ hay làm, từ viết tắt, các lần sửa AI) dùng cho mọi hàm AI; 3 cách khởi động nhanh (2 câu hỏi, nhập ghi chú cũ qua `learn-style`, sửa trực tiếp); cài web như ứng dụng (PWA) | ✅ Xong |


---

## Quick Add: AI tách việc, code tính ngày giờ

`parse-task` gửi câu bạn gõ cho AI để **tách thành các việc** và trích nguyên văn cụm từ chỉ thời hạn ("thứ 6 tuần sau", "trước 5h chiều") và thời lượng ("khoảng 3 tiếng"). Ngày giờ và số phút **do code tính** (`supabase/functions/_shared/vi-parse.ts`), không để AI tự cộng ngày. Quy ước:

- Chỉ có ngày → 23:59 ngày đó. "tối nay" → 22:00, "sáng mai" → 12:00 hôm sau (cuối buổi).
- Giờ 1–6 không kèm sáng/chiều → buổi chiều ("họp 2h" = 14:00). Chỉ có giờ đã qua → ngày mai.
- "thứ 6"/"thứ 6 này" → thứ 6 gần nhất (tính cả hôm nay); "thứ 6 tuần sau" → thứ 6 của tuần kế (tuần bắt đầu thứ Hai).
- "cuối tuần" → Chủ Nhật tuần này; "đầu tháng sau" → ngày 1 tháng sau; "cuối tháng" → ngày cuối tháng.

Môn học/dự án được khớp theo tên (không dấu); nếu AI và từ khóa không thống nhất Học hay Việc, chip không gian được tô viền vàng để bạn xác nhận. Khi AI lỗi/hết lượt/ngoại tuyến: "Lưu vào hộp việc" giữ nguyên câu với nhãn **Chưa phân tích**, mở việc đó để "Phân tích lại bằng AI".

Đánh giá thật với Gemini/Groq (tùy chọn):
```bash
GEMINI_API_KEY=… GEMINI_MODEL=… GROQ_API_KEY=… GROQ_MODEL=… \
  deno run --allow-env --allow-net --config supabase/functions/parse-task/deno.json scripts/eval-parse.ts
```

## AI xếp lịch: AI đề xuất, code quyết định

1. `propose-plan` dựng ngữ cảnh trên máy chủ: việc cần xếp (việc con thay cho việc cha; không có ước tính → 60 phút; phút còn lại = ước tính − khối đã có), khung trống tính bằng code từ giờ hành chính, thời khóa biểu + ngoại lệ, khung học, giờ bận Google, giờ yên lặng.
2. AI chỉ nhận JSON gọn: danh sách việc (bí danh T1, T2…) + khung trống. Chế độ riêng tư: tiêu đề cắt còn 60 ký tự, không gửi ghi chú.
3. Mọi khối AI trả về đi qua `validatePlan` (cùng engine với app): sai khung → dời tới giờ hợp lệ gần nhất, không dời được → bỏ kèm cảnh báo. Phút còn thiếu được bổ sung tự động. Cảnh báo "Không đủ thời gian…" và số phút quá tải luôn do code tính.
4. AI lỗi/hết lượt → lịch do Nhịp tự xếp theo quy tắc (có ghi chú rõ trên màn duyệt).
5. Không gì lên Google trước khi bạn bấm Đồng ý. Khi áp dụng, app kiểm tra lại từng khối với lịch **hiện tại** (lịch có thể đã đổi từ lúc đề xuất). "Hoàn tác" trong 10 giây xóa các sự kiện vừa tạo.

Lõi lập lịch nằm ở `supabase/functions/_shared/planning/` và được **cả app lẫn Edge Function** dùng (app import qua `src/lib/time`, `src/lib/planning`). Múi giờ xử lý bằng `Intl` thay cho date-fns-tz để chạy được trên Deno mà không cần thư viện ngoài.

## Đồng bộ Google Calendar

- **Quyền (scope) hẹp nhất**: `openid`, `email`, `calendar.calendarlist.readonly` (liệt kê lịch để chọn), `calendar.events.readonly` (đọc giờ bận + tiêu đề của lịch bạn chọn), `calendar.app.created` (tạo lịch riêng "Nhịp" và chỉ ghi/sửa/xóa sự kiện trong lịch đó). Nhịp **không thể** sửa các lịch khác của bạn. Vì vậy lịch đích luôn là lịch "Nhịp".
- Sự kiện do app tạo: tiêu đề = tên việc, mô tả có link `nhip://task/<id>`, màu theo không gian (Học = xanh, Việc = cam), `extendedProperties.private.appTaskId/appBlockId`, id sự kiện cố định theo khối ⇒ chạy lại không tạo trùng. Nhắc nhở của Google tắt (Nhịp tự nhắc).
- Lịch "Nhịp": đồng bộ tăng dần bằng `syncToken`. Dời sự kiện trên Google → khối trong app đổi giờ; xóa trên Google → khối bị bỏ, việc quay về "Chưa xếp lịch". `410 Gone` → đồng bộ lại toàn bộ.
- Lịch để đọc giờ bận: làm mới khoảng [hôm qua, +35 ngày] với `singleEvents=true` (Google không cho dùng `syncToken` cùng giới hạn thời gian khi cần bung sự kiện lặp). Sự kiện cả ngày và sự kiện "rảnh" được hiển thị nhưng không chặn giờ.
- Sửa cùng lúc ở hai nơi: Google thắng, khối được đánh dấu "Xung đột" (viền đỏ) để bạn xem lại.
- Chạy khi mở app / quay lại app, khi kéo để làm mới, sau khi duyệt/dời/bỏ khối, và mỗi 15 phút bằng pg_cron.
- Token bị thu hồi → trạng thái "Google đã thu hồi quyền truy cập. Hãy kết nối lại." + nút **Kết nối lại**.

## Nhắc nhở

- **Trên máy (local)**: chỉ nhắc "sắp bắt đầu" cho các khối đã duyệt, mặc định trước 10 phút. iOS cho tối đa 64 thông báo chờ, nên app chỉ giữ **50 khối gần nhất** và lập lại lịch nhắc khi mở app, sau đồng bộ và khi khối thay đổi. Nếu giờ nhắc rơi vào giờ yên lặng, nhắc được dời tới lúc hết giờ yên lặng. Nút "Bắt đầu" chuyển việc sang "đang làm" và mở việc. "Hoãn 15 phút" nhắc lại sau 15 phút.
- **Từ máy chủ (push)**: `push-dispatch` chạy 5 phút/lần (pg_cron) và gửi qua Expo Push:
  - tóm tắt buổi sáng (mặc định 07:00) → mở `/brief`;
  - tổng kết buổi tối (21:30) → mở `/review`;
  - nhắc hạn chót ở mỗi mốc (mặc định 7 ngày và 1 ngày trước), ví dụ "Còn 1 ngày: Báo cáo môn Mạng (ước tính 3 giờ, mới xếp được 2 giờ)".
- Chống gửi trùng: mỗi thông báo được "giữ chỗ" trong `notification_log` (khóa duy nhất theo người dùng) **trước** khi gửi; gửi lỗi thì nhả chỗ để lần chạy sau thử lại.
- Nội dung tóm tắt/tổng kết do code tính (`_shared/brief-core.ts`), giống hệt nội dung màn `/brief` và `/review` trong app.
- Cần `EAS_PROJECT_ID` để lấy push token. Tùy chọn: `EXPO_ACCESS_TOKEN` (secret của Edge Function) nếu bật bảo mật push trên Expo.
- Deploy: `npx supabase functions deploy push-dispatch` (cron gọi bằng service key; hàm từ chối mọi lời gọi khác).



## Bắt đầu (onboarding)

Lần đầu đăng nhập, Nhịp đưa bạn qua tối đa 5 bước (bước có thể bỏ qua được ghi rõ):
1. Đăng nhập (Apple / Google).
2. Kết nối Google Calendar — giải thích vì sao cần và cách vượt cảnh báo "Google chưa xác minh ứng dụng này" (*có thể bỏ qua*).
3. Giờ hành chính — mặc định T2–T6 08:00–17:00, nghỉ trưa 12:00–13:00.
4. Thời khóa biểu — thêm nhanh: chọn môn (hoặc gõ môn mới) → thứ → giờ (*có thể bỏ qua*).
5. Thông báo — xin quyền ngay tại chỗ, kèm giải thích (*có thể bỏ qua*).

Xong thì về **Hôm nay**, kèm ghi chú ghim "Hướng dẫn nhanh". Xem lại bất cứ lúc nào: Cài đặt → *Xem lại hướng dẫn bắt đầu*.

## Cài đặt

| Mục | Nội dung |
|---|---|
| Google Calendar | kết nối/ngắt, lịch để đọc giờ bận, lịch "Nhịp", đồng bộ ngay |
| Giờ hành chính | giờ làm + nghỉ trưa từng ngày, "Áp dụng giờ thứ Hai cho T3–T6"; giờ sai được báo ngay, không lưu |
| Thời khóa biểu | buổi học hằng tuần theo môn (phòng học, cảnh báo trùng giờ) + ngoại lệ theo ngày: **Nghỉ**, **Dời buổi**, **Học bù** |
| Khung giờ học | các khung được xếp việc Học (có thể qua nửa đêm), sao chép sang các ngày khác |
| Sức chứa mỗi ngày | phút tập trung tối đa cho Học / Việc từng ngày (bước 30 phút) |
| Nhắc nhở | tóm tắt sáng, tổng kết tối, nhắc trước khối, nhắc hạn chót, giờ yên lặng |
| Môn học & dự án | thêm, đổi tên, lưu trữ |
| AI | chế độ riêng tư, nhà cung cấp (Gemini → Groq → quy tắc), lượt AI hôm nay |
| Dữ liệu | **Xuất dữ liệu (.zip)**, xóa bộ nhớ đệm trên máy, đăng xuất |

Mọi thay đổi lưu ngay (đi qua hàng đợi ghi offline) và lần đề xuất lịch kế tiếp dùng luôn.

### Xuất dữ liệu
Tệp `nhip-du-lieu-YYYYMMDD-HHmm.zip` (trên iPhone mở bảng chia sẻ, trên web tải xuống) gồm:
- `nhip-du-lieu.json` — mọi bảng của bạn (việc, khối lịch, ghi chú, đính kèm, thời khóa biểu, cài đặt…). **Không** gồm mã truy cập Google, token thông báo, bộ đệm sự kiện Google.
- `ghi-chu/<ngày>-<tên>.md` — mỗi ghi chú một tệp Markdown (tiêu đề, danh sách, checklist, liên kết, ảnh) kèm tóm tắt và bản chép lời ghi âm.
- `ghi-am-va-anh.md` — danh sách bản ghi âm (từng đoạn) và ảnh, có đường tải xuống hạn 7 ngày.
- `Đọc trước.md` — mô tả nội dung.

## ✦ Chia nhỏ việc này

Trong chi tiết việc: AI (`split-task`) đề xuất 2–7 bước cụ thể. Code dọn kết quả: bỏ bước trùng (kể cả trùng việc con đã có), mỗi bước 10–90 phút (bội số 5), và nếu việc có ước tính thì co giãn cho khớp phần chưa có việc con. Bạn sửa tên, đổi thời lượng, bỏ bước rồi bấm **Tạo n việc con** (nguồn `ai_split`). Chế độ riêng tư: AI chỉ nhận tiêu đề, thời lượng, hạn chót — không nhận mô tả.

## Nhịp hiểu về bạn (hồ sơ thói quen)

Không cần huấn luyện mô hình: Nhịp học từ chính dữ liệu của bạn và đưa phần tóm tắt vào **mọi** lần gọi AI (Quick Add, xếp lịch, chia nhỏ việc, tóm tắt/tìm việc trong ghi chú). Quy tắc lịch vẫn luôn thắng.

| Nhịp học gì | Từ đâu | Dùng thế nào |
|---|---|---|
| Thời gian thật so với dự kiến (theo không gian và theo môn/dự án) | Thời gian thật bạn ghi ở bước tổng kết tối (`actual_minutes`), 120 ngày gần nhất | Xếp lịch nhân thời lượng theo tỉ lệ (code tính, 0,6×–2,2×). Ít dữ liệu thì kéo về câu trả lời của bạn |
| Giờ hay làm | Giờ bạn bấm "Xong", 60 ngày gần nhất, theo khung 2 giờ | Gợi ý cho AI ưu tiên các khung đó |
| Từ viết tắt & biệt danh môn/dự án (`mmt` = Mạng máy tính) | Bạn thêm · nhập ghi chú cũ · tự học khi bạn sửa môn sau Quick Add | Biệt danh khớp nguyên từ thì **code** gán đúng môn, đè lên đoán của AI |
| Các lần bạn sửa AI | So gợi ý của AI với cái bạn lưu trong Quick Add (giữ 30 lần gần nhất) | Đưa lại cho AI làm ví dụ (tắt khi bật chế độ riêng tư) |

Khởi động nhanh: thẻ **"Giúp Nhịp hiểu bạn nhanh hơn"** trên Hôm nay → 2 câu hỏi (hay trễ giờ? tập trung lúc nào?); hoặc Cài đặt → **Nhịp hiểu về bạn** → dán ghi chú cũ (`learn-style` chỉ đề xuất, bạn chọn từ nào giữ; nội dung dán không được lưu). Trang này cho xem, sửa, tắt học hoặc xoá toàn bộ hồ sơ. Bảng: `habit_settings`, `vocab_entries`, `ai_corrections` (migration 006, RLS theo người dùng, có trong file xuất dữ liệu).

## Dữ liệu mẫu (seed)

```bash
# Đăng nhập app một lần để tạo tài khoản, rồi trên máy của bạn:
SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  node scripts/seed/seed.mjs --email ban@example.com          # thêm --wipe để xóa dữ liệu cũ của tài khoản đó
```
Tạo: 2 môn học (Mạng máy tính, Cơ sở dữ liệu), 2 dự án (Website An Phát, Báo cáo quý IV), thời khóa biểu 4 buổi/tuần + 1 buổi nghỉ + 1 buổi học bù, giờ hành chính T2–T6 08:00–17:00 (nghỉ 12:00–13:00), khung giờ học, sức chứa, 15 việc với hạn đa dạng (2 quá hạn, hôm nay, ngày mai, tuần này, tuần sau, không hạn; 1 việc 6 giờ hạn sáng mai để thấy cảnh báo "không kịp"), 4 việc con, 5 ghi chú có đính kèm (liên kết + 2 ảnh tải lên Storage). Service role key chỉ dùng trên máy bạn, không bao giờ đưa vào app.

## Đã kiểm chứng (QA)

Tự động, chạy lại được:
- **Jest**: ngày giờ tiếng Việt, khung trống, sức chứa, `validatePlan`/`greedyPlan`, lập lịch thông báo (giới hạn 64), mô hình ghi chú, link preview + SSRF, phiên âm, hàng đợi tải lên, cài đặt giờ giấc, xuất dữ liệu, chia nhỏ việc, hồ sơ thói quen.
- **Postgres thật** (`scripts/db-check`): migrations + RLS, tìm kiếm không dấu, giới hạn lượt AI, Vault, hồ sơ thói quen (RLS, biệt danh không trùng, tự cắt còn 30 lần sửa).
- **Đầu-cuối trên dữ liệu seed** (PostgREST + Edge Functions thật, AI giả lập):
  - AI cố tình đề xuất 40 khối sai (Việc lúc 20:00 và giờ nghỉ trưa, Học trùng giờ lên lớp/giờ hành chính, khối 3,5 giờ) → sau khi code kiểm tra: **0 khối Việc ngoài giờ hành chính hay trong giờ nghỉ trưa, 0 khối Học trùng giờ học hoặc giờ hành chính**, không chồng lấn, đệm ≥ 10 phút, không khối nào sau hạn chót.
  - Việc 6 giờ hạn 10:00 sáng mai → cảnh báo rõ "không đủ thời gian", không âm thầm bỏ.
  - Gemini trả 429 → Quick Add tự chuyển sang Groq, người dùng không thấy lỗi.
  - Hồ sơ thói quen: AI đoán sai dự án cho "nộp bt mmt" → biệt danh đã học sửa thành Mạng máy tính; người dùng hay làm lâu 1,45× → việc 60 phút được xếp 90 phút; tắt học → xếp đúng 60 phút và prompt không còn hồ sơ; chế độ riêng tư → câu người dùng từng gõ không rời máy chủ, `learn-style` trả 403.
  - Chế độ riêng tư bật → không request nào tới AI chứa nội dung ghi chú hay mô tả việc; tóm tắt ghi chú/phiên âm bị từ chối.
- **Giao diện**: mọi màn hình ở 320/375/440 pt và 1280 px — không lỗi console, không tràn ngang, mọi nút có nhãn trợ năng; trạng thái ngoại tuyến hiển thị đúng.

Cần làm trên **iPhone thật** (không giả lập được ở đây): ghi âm 90 phút khi khóa màn hình + cuộc gọi chen ngang, push sáng/tối/hạn chót đúng giờ, ≤ 64 thông báo chờ, Google Calendar thật (duyệt → hiện trong lịch "Nhịp", dời/xóa trên Google → app cập nhật, Hoàn tác xóa sự kiện).

## Ghi chú giàu nội dung

- **Trình soạn thảo** viết bằng component gốc (không WebView), chạy giống nhau trên iPhone và web. Nội dung lưu dạng JSON trong `notes.content_json`: danh sách khối `h1`, `h2`, `p`, `bullet`, `number`, `check`, `image`, `link`, `audio` (`src/lib/notes/doc.ts`, có test). Đậm/nghiêng là `**…**` / `_…_` trong khối chữ: khi không gõ, khối hiện chữ đã định dạng; chạm vào để sửa. `Ctrl/⌘+B`, `Ctrl/⌘+I` trên web.
- Enter tách khối (danh sách tự nối tiếp, Enter ở mục trống thì thoát danh sách); Backspace ở đầu khối gộp lên khối trên. Dán nhiều dòng → mỗi dòng một khối.
- Thanh công cụ dính trên đầu: 📷 🎙 🔗 ☑ ✦ AI, rồi H1/H2, **B**/_I_, danh sách. Dòng checklist có nút "Chuyển thành việc" (việc gắn với ghi chú, mũi tên xanh mở việc).
- Ghi chú cũ dạng văn bản thường (giai đoạn 2) được chuyển tự động khi mở. `plain_text` luôn được tính lại để tìm kiếm.
- Tự lưu 2 giây sau thay đổi cuối, khi rời màn hình và khi app vào nền ("Đã lưu").
- **✦ AI** (`note-ai`): *Tóm tắt ghi chú* (ý chính, thuật ngữ, bài tập — "Chèn vào ghi chú") và *Tìm việc cần làm* (gợi ý, bạn chọn việc nào để tạo; ngày giờ do code tính như Quick Add). Gửi cả bản chép lời của các ghi âm trong ghi chú. Tắt khi bật chế độ riêng tư.

## Ảnh và liên kết

- Chụp hoặc chọn nhiều ảnh → nén cạnh dài ≤ 1920 px, JPEG ~80 % + thumbnail 480 px → lưu ngay trên máy (hiện tức thì, kể cả offline) → hàng đợi tải lên nền vào bucket private `attachments/<user_id>/…`. Thiết bị khác xem qua signed URL (1 giờ, không lưu vào cache đĩa). Chạm ảnh để xem toàn màn hình: chụm để phóng to, kéo, chạm hai lần.
- Liên kết hiện thành thẻ (tiêu đề, mô tả, ảnh, tên trang) lấy từ `link-preview`: chỉ http(s) cổng mặc định, chặn localhost/IP nội bộ/metadata (kiểm tra cả DNS và từng bước chuyển hướng, tối đa 3), 5 giây, đọc tối đa 512 KB, chỉ trả văn bản đã làm sạch. Mở bằng trình duyệt trong app.
- Xóa ghi chú/việc/khối media xóa luôn file trên Storage.

## Ghi âm bài giảng & phiên âm

- Mở từ 🎙 trong ghi chú, nút micro ở tab Ghi chú (tạo ghi chú mới trong môn/dự án bạn chọn) hoặc "Ghi âm" trong chi tiết việc.
- Đồng hồ cỡ lớn, mức âm, tạm dừng/tiếp tục, **Đánh dấu** (hiện thành vạch trên thanh phát), **Dừng & lưu**. Có thể khóa màn hình hoặc chuyển màn khác — viên "● Đang ghi" ở góc dưới đưa bạn quay lại.
- AAC mono ~40 kbps. Cứ ~10 phút app đóng đoạn hiện tại, chép vào Documents, tạo bản ghi `audio_segments` và đưa vào hàng đợi tải lên nền (phiên tải nền của iOS) rồi ghi tiếp. App bị tắt giữa chừng chỉ mất đoạn đang ghi; lần mở sau các đoạn đã đóng được giữ lại.
- Bị gián đoạn (cuộc gọi, Siri, app khác dùng micro): ghi âm tạm dừng, có thông báo nếu app đang ở nền; nhấn **Tiếp tục** để ghi tiếp sang đoạn mới.
- Phát lại liền mạch qua các đoạn, tua bằng thanh hoặc ±15 giây, tốc độ 1–2×, chạm dòng chép lời hoặc dấu đánh dấu để nhảy tới.
- **Phiên âm & tóm tắt** (`transcribe-audio`): mỗi đoạn được gửi riêng, lần lượt (không chạy song song hai đoạn của cùng bản ghi): Gemini (audio) trước, Groq Whisper dự phòng. Mốc thời gian được cộng vị trí đoạn. Lỗi tạm thời thử lại sau 30 giây/2 phút (tối đa 3 lần), vượt giới hạn tốc độ thì chờ lâu hơn mà không tính lượt. App hiện "Đang xử lý đoạn 3/12"; đoạn lỗi có nút **Thử lại** riêng. Xong tất cả → bản chép lời đầy đủ + tóm tắt `{ý chính, thuật ngữ, bài tập}`; mỗi bài tập có **Tạo việc từ đây** (hạn chót "thứ 6 tuần sau" được code tính).
- Việc xử lý chạy nền trên máy chủ (`EdgeRuntime.waitUntil`) và pg_cron chạy tiếp mỗi phút khi còn đoạn chờ, nên không cần giữ app mở. Bản chép lời được tìm kiếm cùng việc và ghi chú.
- Chế độ riêng tư bật → không gửi âm thanh cho AI (nút phiên âm được thay bằng lời giải thích).
- Web: ghi được (WebM/MP4 tùy trình duyệt, WebM đi qua Whisper trước) nhưng phải giữ tab mở — app ghi "Ghi âm dài nên dùng trên iPhone".

## Bản demo trên trình duyệt

`npm run build:demo` tạo `dist-demo/`: app chạy hoàn toàn trong trình duyệt với dữ liệu mẫu (`src/lib/api/demo/`): một client giả lập Supabase trong bộ nhớ, Thêm nhanh bằng quy tắc thay cho AI, xếp lịch bằng lõi lập lịch thật nhưng không gọi AI. Ghi chú "Bài giảng TCP/IP – tuần 5" có sẵn ảnh bảng, thẻ liên kết và một bản ghi đã phiên âm + tóm tắt (bản demo không kèm tệp âm thanh mẫu). Ghi âm thật trong trình duyệt được; phần phiên âm/AI ghi chú trong demo là nội dung mẫu. Không cần Supabase, khóa AI hay Google. Dữ liệu lưu trong `localStorage` nếu có. Đường dẫn tài nguyên là tương đối nên có thể đặt ở bất kỳ thư mục nào.

## Ngoại tuyến

- Đọc: Hôm nay, Việc, Ghi chú được cache (AsyncStorage / localStorage) 7 ngày.
- Ghi: tạo/sửa/xong/xóa việc, sửa ghi chú… được xếp hàng theo đúng thứ tự (một scope duy nhất), lưu lại kể cả khi đóng app, và gửi khi có mạng. Header hiện "Chờ đồng bộ · n". ID tạo ở máy nên việc con/liên kết tạo offline vẫn gắn đúng.
- Ảnh và đoạn ghi âm: lưu trên máy trước, tải lên khi có mạng (thử lại giãn dần tới 10 phút); yêu cầu phiên âm làm offline được gửi khi có mạng.
- AI: hiện "Cần kết nối mạng".

## Cấu trúc

```
app/                      Expo Router (routes)
  (tabs)/                 index (Hôm nay), tasks, notes, calendar
  settings/               Cài đặt
src/
  components/             AppText, Button, Card, CapacityBar, DayTimeline, Sheet, SpaceFilterControl, EmptyState, AppTabBar
  features/               today, quick-add, notes (trình soạn thảo), media (ảnh, link, ghi âm, phát lại),
                          record (bộ ghi nền), settings, onboarding, … (mỗi tính năng một thư mục)
  hooks/                  useResponsive, useKeyboardShortcuts, useNow
  lib/
    time/                 tz.ts, intervals.ts, slots.ts, format.ts
    planning/             capacity.ts, priority.ts, engine.ts, validatePlan.ts, greedyPlan.ts
    notifications/        local.ts (bộ lập lịch giới hạn 64 của iOS)
    notes/                doc.ts (mô hình nội dung ghi chú)
    media/                hàng đợi tải lên, ảnh, tệp trên máy, tiện ích ghi âm
    settings/             kiểm tra & tóm tắt giờ giấc (hours.ts), rulesFromSettings
    export/               dựng & nén tệp xuất dữ liệu
    api/                  supabase.ts, queryClient.ts
  stores/                 ui.ts (Zustand)
  theme/                  tokens.ts, typography.ts, ThemeProvider.tsx
  i18n/vi.ts              mọi chuỗi tiếng Việt
  __tests__/              Jest
supabase/
  migrations/             schema, RLS, tìm kiếm, cron
  functions/
    _shared/              ai-provider (Gemini/Groq + fallback), vi-parse, parse-task-core, planning/, google, brief-core,
                          link-preview-core, transcribe-core, note-ai-core, http, context
    parse-task/ propose-plan/ gcal-auth/ gcal-sync/ push-dispatch/ link-preview/ transcribe-audio/ note-ai/ split-task/
scripts/db-check/         chạy migrations trên Postgres tạm + kiểm tra RLS
scripts/seed/seed.mjs     dữ liệu mẫu cho một tài khoản
```

### Quy ước thời gian
- Mọi thời điểm lưu dạng `timestamptz` (UTC). Trong code là epoch ms (`Instant`).
- Ngày địa phương là `DateKey` (`yyyy-MM-dd`), giờ địa phương là `HHmm` (`HH:mm`), chỉ chuyển đổi qua `src/lib/time/tz.ts`.
- Múi giờ mặc định `Asia/Ho_Chi_Minh`, lưu trong `profiles.timezone`.

### Lập kế hoạch: AI đề xuất, code kiểm tra
`PlacementEngine.checkPlacement` là nơi **duy nhất** quyết định một khối có hợp lệ không: trong khung giờ của không gian (Việc: giờ hành chính trừ nghỉ trưa; Học: khung học, không chồng lớp/giờ hành chính), không trùng lịch bận/lớp/khối khác (đệm 10 phút), không vượt sức chứa ngày, ≤ 90 phút/khối, ≤ 3 giờ tập trung liên tục, trước hạn chót. `validatePlan` dùng nó để kiểm tra và tự sửa kết quả AI; `greedyPlan` dùng nó để tự xếp khi AI không khả dụng hoặc khi bấm "Cân bằng lại". Cảnh báo "không đủ thời gian" và số phút quá tải luôn do code tính.

---

## Yêu cầu

- Node.js ≥ 20, npm
- Tài khoản Supabase, Supabase CLI (`npx supabase`)
- Tài khoản Apple Developer (đã có) + EAS CLI (`npm i -g eas-cli`)

## Chạy local

```bash
npm install
cp .env.example .env        # điền EXPO_PUBLIC_SUPABASE_URL / ANON_KEY
npm run web                 # trình duyệt
npm run ios                 # cần development build (xem EAS bên dưới)
```

## Kiểm thử

```bash
npm test                    # Jest: tz, slots, capacity, priority, validatePlan/greedyPlan, thông báo,
                            #       ngày giờ tiếng Việt, pipeline parse-task (provider giả), nhóm việc, checklist,
                            #       mô hình ghi chú, link preview + SSRF, phiên âm (fallback, thử lại, ghép đoạn), hàng đợi tải lên
npm run typecheck           # tsc --noEmit
npm run lint                # ESLint (eslint-config-expo)
npm run check:functions     # deno check tất cả Edge Functions (cần Deno)
cd scripts/db-check && npm install && npm run check   # migrations + RLS trên Postgres thật
```

`db-check` dựng một Postgres tạm (giả lập các schema do Supabase quản lý: `auth`, `storage`, `vault`, `cron`, `net`), chạy toàn bộ migrations, rồi kiểm tra: RLS chặn người dùng khác, tìm kiếm không dấu ("bao cao mang" khớp "Báo cáo môn Mạng"), giới hạn lượt gọi AI/ngày, lưu refresh token trong Vault.

---

## Thiết lập Supabase

1. Tạo project tại supabase.com (region gần nhất: Singapore).
2. Trong thư mục dự án:
   ```bash
   npx supabase init          # tạo supabase/config.toml, giữ nguyên migrations/
   npx supabase link --project-ref <project-ref>
   npx supabase db push       # áp dụng toàn bộ migrations
   ```
3. Bật extension (Dashboard → Database → Extensions): `pg_cron`, `pg_net`, `unaccent` (migrations tự bật nếu có quyền).
4. Lưu 2 secret cho cron vào Vault (SQL Editor):
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
   select vault.create_secret('<service-role-key>', 'service_role_key');
   ```
   Cron gọi `gcal-sync` mỗi 15 phút, `push-dispatch` mỗi 5 phút và `transcribe-audio` mỗi phút (chỉ khi còn đoạn ghi âm chờ xử lý). Trước khi các function đó được deploy lời gọi chỉ trả 404 và bị bỏ qua.
5. Auth → URL Configuration → Redirect URLs: thêm `nhip://auth/callback` (iPhone) và địa chỉ web của bạn (vd. `https://nhip.example.com`, `http://localhost:8081`).
6. Auth → Providers:
   - **Google**: tạo OAuth client loại *Web application* trong Google Cloud (có thể dùng chung project với Calendar ở giai đoạn 3), redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`, dán Client ID/Secret vào Supabase.
   - **Apple**: trên iPhone app dùng nút đăng nhập Apple gốc (`signInWithIdToken`) — thêm bundle id `app.nhip.planner` (và `.preview`, `.dev`) vào ô *Client IDs* của provider Apple. Đăng nhập Apple trên web cần thêm Services ID + khóa `.p8` (xem tài liệu Supabase "Login with Apple"); nếu chỉ dùng web, đăng nhập Google là đủ.
7. Deploy Edge Function và đặt secrets:
   ```bash
   npx supabase secrets set GEMINI_API_KEY=… GEMINI_MODEL=… GROQ_API_KEY=… GROQ_MODEL=… GROQ_STT_MODEL=… AI_DAILY_CALL_LIMIT=200
   npx supabase secrets set GOOGLE_OAUTH_CLIENT_ID=… GOOGLE_OAUTH_CLIENT_SECRET=… \
     GOOGLE_OAUTH_REDIRECT_URI=https://<project-ref>.supabase.co/functions/v1/gcal-auth/callback \
     WEB_APP_URL=https://<địa-chỉ-web-của-bạn>
   npx supabase functions deploy parse-task
   npx supabase functions deploy propose-plan
   npx supabase functions deploy gcal-sync
   npx supabase functions deploy gcal-auth --no-verify-jwt   # Google redirect không mang JWT; hàm tự kiểm tra
   npx supabase functions deploy push-dispatch
   npx supabase functions deploy link-preview
   npx supabase functions deploy transcribe-audio
   npx supabase functions deploy note-ai
   npx supabase functions deploy split-task
   npx supabase functions deploy learn-style
   ```
   Lấy key Gemini miễn phí tại aistudio.google.com, key Groq tại console.groq.com. Đặt `GEMINI_MODEL` là model Flash miễn phí mới nhất đang có trong AI Studio (cần nhận âm thanh); `GROQ_MODEL` là một model chat hỗ trợ JSON mode; `GROQ_STT_MODEL` là model Whisper của Groq (dự phòng phiên âm, bỏ trống = không dự phòng).

Bucket lưu trữ `attachments` được tạo ở chế độ **private**; file nằm dưới `<user_id>/…` và chỉ đọc qua signed URL.

## Biến môi trường

| Biến | Ở đâu | Ghi chú |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `.env` / EAS | công khai |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `.env` / EAS | công khai, RLS bảo vệ dữ liệu |
| `EAS_PROJECT_ID` | `.env` / EAS | sau `eas init` |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | `supabase secrets set` | model Flash miễn phí mới nhất, không hardcode |
| `GROQ_API_KEY`, `GROQ_MODEL` | `supabase secrets set` | dự phòng cho tác vụ văn bản |
| `GROQ_STT_MODEL` | `supabase secrets set` | model Whisper của Groq — dự phòng phiên âm (tùy chọn) |
| `GEMINI_BASE_URL`, `GROQ_BASE_URL` | `supabase secrets set` | tùy chọn, khi đi qua API gateway/proxy |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` | `supabase secrets set` | giai đoạn 3 |
| `AI_DAILY_CALL_LIMIT` | `supabase secrets set` | mặc định 200 |
| `WEB_APP_URL` | `supabase secrets set` | địa chỉ web của app (link trong sự kiện Google, cho phép quay lại sau OAuth) |
| `EXPO_ACCESS_TOKEN` | `supabase secrets set` | tùy chọn, khi bật "enhanced push security" trên Expo |
| `EXPO_PUBLIC_DEMO` | build | `1` = bản demo trong trình duyệt (dùng qua `npm run build:demo`) |

**Không bao giờ** đặt khóa API của AI hay Google vào biến `EXPO_PUBLIC_*`.

---

## Google Cloud OAuth

1. console.cloud.google.com → tạo project "Nhip".
2. APIs & Services → Library → bật **Google Calendar API**.
3. OAuth consent screen → User type **External** → điền tên ứng dụng, email hỗ trợ.
4. Data Access → Add scopes: `openid`, `email`, `.../auth/calendar.calendarlist.readonly`, `.../auth/calendar.events.readonly`, `.../auth/calendar.app.created` (đã đối chiếu danh sách scope Calendar API hiện hành của Google; lý do chọn ở mục "Đồng bộ Google Calendar").
5. Test users: thêm email Google của bạn.
6. **Publishing status → bấm "Publish app" để chuyển sang "In production".** Ở trạng thái "Testing", refresh token hết hạn sau 7 ngày và bạn sẽ phải kết nối lại mỗi tuần. Với mục đích cá nhân, ứng dụng chưa xác minh ở trạng thái "In production" vẫn dùng được; khi đăng nhập Google sẽ cảnh báo "Google chưa xác minh ứng dụng này" → chọn **Nâng cao → Đi tới Nhip (không an toàn)**.
7. Credentials → Create OAuth client ID → **Web application**; Authorized redirect URI: `https://<project-ref>.supabase.co/functions/v1/gcal-auth/callback`.
8. Lưu Client ID / Secret bằng `supabase secrets set`.

---

## Build iOS (EAS) & TestFlight

```bash
eas login
eas init                              # ghi projectId, đặt EAS_PROJECT_ID
eas build --profile development --platform ios   # bản dev cài lên iPhone
eas build --profile preview --platform ios       # bản TestFlight
eas submit --profile preview --platform ios      # điền ascAppId trong eas.json trước
```

Cấu hình iOS trong `app.config.ts`: chế độ nền `audio` (ghi âm khi khóa màn hình), chuỗi xin quyền micro/camera/ảnh bằng tiếng Việt. iOS không có chuỗi Info.plist cho thông báo — app giải thích bằng tiếng Việt ngay trước khi hỏi quyền.

## Deploy web

```bash
npm run export:web          # xuất ra dist/
```
Đưa thư mục `dist/` lên Netlify / Vercel / Cloudflare Pages (cấu hình SPA: mọi đường dẫn → `index.html`). Đặt biến `EXPO_PUBLIC_*` trước khi export.

**Cài như ứng dụng:** `public/manifest.json` + `public/sw.js` làm web cài được — Chrome/Edge trên máy tính hiện nút **Cài đặt** trên thanh địa chỉ, Android "Thêm vào màn hình chính", iPhone Safari → Chia sẻ → **Thêm vào Màn hình chính**. Service worker không lưu đệm gì (tránh giữ bản cũ sau khi cập nhật); dùng ngoại tuyến vẫn nhờ hàng đợi ghi của app.

Trên web, ghi âm dài và thông báo cục bộ bị giới hạn — app sẽ hiển thị "Ghi âm dài nên dùng trên iPhone".

## Phím tắt (web)

`N` thêm nhanh · `/` tìm kiếm · `G` rồi `T`/`V`/`N`/`L` tới Hôm nay/Việc/Ghi chú/Lịch · `Esc` đóng
