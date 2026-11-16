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
| 2. Dữ liệu & Việc | Đăng nhập (Apple/Google), truy vấn có kiểu, Việc/Ghi chú CRUD, Quick Add + Edge Function `parse-task` (Gemini → Groq), ≥ 20 fixture tiếng Việt, hàng đợi offline | ⏳ |
| 3. Lịch & AI xếp lịch | `gcal-auth`, `gcal-sync`, `propose-plan`, màn hình duyệt đề xuất, Hoàn tác, màn Lịch (Ngày/3 ngày/Tuần), kéo thả | ⏳ |
| 4. Nhắc nhở | Thông báo cục bộ (≤ 50), `push-dispatch`, bản tóm tắt sáng / tổng kết tối | ⏳ |
| 5. Ghi âm & Ghi chú giàu nội dung | Trình soạn thảo, ảnh, link preview, ghi âm nền theo đoạn, `transcribe-audio`, tóm tắt | ⏳ |
| 6. Hoàn thiện | Onboarding, Cài đặt đầy đủ, seed, xuất dữ liệu, QA trên iPhone thật | ⏳ |

Các màn hình chưa tới giai đoạn của mình hiển thị trạng thái "Đang xây dựng" — không có nút giả.

---

## Cấu trúc

```
app/                      Expo Router (routes)
  (tabs)/                 index (Hôm nay), tasks, notes, calendar
  settings/               Cài đặt
src/
  components/             AppText, Button, Card, CapacityBar, DayTimeline, Sheet, SpaceFilterControl, EmptyState, AppTabBar
  features/               today, quick-add, … (mỗi tính năng một thư mục)
  hooks/                  useResponsive, useKeyboardShortcuts, useNow
  lib/
    time/                 tz.ts, intervals.ts, slots.ts, format.ts
    planning/             capacity.ts, priority.ts, engine.ts, validatePlan.ts, greedyPlan.ts
    notifications/        local.ts (bộ lập lịch giới hạn 64 của iOS)
    api/                  supabase.ts, queryClient.ts
  stores/                 ui.ts (Zustand)
  theme/                  tokens.ts, typography.ts, ThemeProvider.tsx
  i18n/vi.ts              mọi chuỗi tiếng Việt
  __tests__/              Jest
supabase/
  migrations/             schema, RLS, tìm kiếm, cron
scripts/db-check/         chạy migrations trên Postgres tạm + kiểm tra RLS
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
npm test                    # Jest: tz, slots, capacity, priority, validatePlan/greedyPlan, thông báo
npm run typecheck           # tsc --noEmit
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
   Cron gọi `gcal-sync` mỗi 15 phút và `push-dispatch` mỗi 5 phút. Trước khi các function đó được deploy (giai đoạn 3–4) lời gọi chỉ trả 404 và bị bỏ qua.
5. Auth → Providers: bật **Apple** và **Google** (chi tiết ở giai đoạn 2). Thêm `nhip://` vào Redirect URLs.

Bucket lưu trữ `attachments` được tạo ở chế độ **private**; file nằm dưới `<user_id>/…` và chỉ đọc qua signed URL.

## Biến môi trường

| Biến | Ở đâu | Ghi chú |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `.env` / EAS | công khai |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `.env` / EAS | công khai, RLS bảo vệ dữ liệu |
| `EAS_PROJECT_ID` | `.env` / EAS | sau `eas init` |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | `supabase secrets set` | model Flash miễn phí mới nhất, không hardcode |
| `GROQ_API_KEY`, `GROQ_MODEL` | `supabase secrets set` | dự phòng cho tác vụ văn bản |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` | `supabase secrets set` | giai đoạn 3 |
| `AI_DAILY_CALL_LIMIT` | `supabase secrets set` | mặc định 200 |

**Không bao giờ** đặt khóa API của AI hay Google vào biến `EXPO_PUBLIC_*`.

---

## Google Cloud OAuth (chuẩn bị cho giai đoạn 3)

1. console.cloud.google.com → tạo project "Nhip".
2. APIs & Services → Library → bật **Google Calendar API**.
3. OAuth consent screen → User type **External** → điền tên ứng dụng, email hỗ trợ.
4. Scopes: chọn phạm vi hẹp nhất đủ dùng (đọc sự kiện/free-busy của lịch được chọn; tạo/sửa/xóa sự kiện trong lịch đích). Tên scope chính xác sẽ được kiểm tra lại với tài liệu Google khi triển khai và ghi vào đây.
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

Trên web, ghi âm dài và thông báo cục bộ bị giới hạn — app sẽ hiển thị "Ghi âm dài nên dùng trên iPhone".

## Phím tắt (web)

`N` thêm nhanh · `G` rồi `T`/`V`/`N`/`L` tới Hôm nay/Việc/Ghi chú/Lịch · `Esc` đóng · `/` tìm kiếm (giai đoạn 2)
