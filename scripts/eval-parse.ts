/**
 * Optional live evaluation of parse-task against the real AI providers.
 * Usage (keys never committed):
 *   GEMINI_API_KEY=… GEMINI_MODEL=… [GROQ_API_KEY=… GROQ_MODEL=…] \
 *   deno run --allow-env --allow-net --config supabase/functions/parse-task/deno.json scripts/eval-parse.ts
 * Prints each phrase with the resolved deadline/estimate so you can eyeball the model's segmentation.
 */
import { generateStructured, GeminiProvider, GroqProvider, type AIProvider } from '../supabase/functions/_shared/ai-provider.ts';
import { AiParseResponse, buildPrompt, finalizeParse } from '../supabase/functions/_shared/parse-task-core.ts';
import { formatIsoTz } from '../supabase/functions/_shared/vi-parse.ts';

const TZ = 'Asia/Ho_Chi_Minh';
const providers: AIProvider[] = [];
const g = Deno.env.get('GEMINI_API_KEY');
const gm = Deno.env.get('GEMINI_MODEL');
if (g && gm) providers.push(new GeminiProvider(g, gm));
const q = Deno.env.get('GROQ_API_KEY');
const qm = Deno.env.get('GROQ_MODEL');
if (q && qm) providers.push(new GroqProvider(q, qm));
if (!providers.length) throw new Error('Set GEMINI_* and/or GROQ_* env vars');

const collections = [
  { id: 'c1', name: 'Mạng máy tính', space: 'study' as const },
  { id: 'c2', name: 'Cơ sở dữ liệu', space: 'study' as const },
  { id: 'p1', name: 'Website Kim Long', space: 'work' as const },
];
const phrases = [
  'thứ 6 nộp báo cáo môn Mạng, mất khoảng 3 tiếng',
  'mai gọi khách hàng A, thứ 4 họp team 2h chiều',
  'ôn thi CSDL trước thứ 6 tuần sau, 2 tiếng',
  'tối nay làm bài tập mạng 45 phút',
  'cuối tuần dọn phòng và mua quà sinh nhật mẹ',
  'đầu tháng sau nộp hồ sơ học bổng',
  'sửa banner website Kim Long trước 5h chiều',
  'mốt gửi báo giá cho anh Minh',
];
const now = Date.now();
for (const text of phrases) {
  const prompt = buildPrompt({
    text,
    nowIso: formatIsoTz(now, TZ),
    weekdayVi: '',
    tz: TZ,
    collections,
    officeHoursSummary: 'T2–T6 08:00–17:00',
  });
  try {
    const res = await generateStructured(providers, AiParseResponse, prompt);
    const out = finalizeParse(res.data, { text, now, tz: TZ, collections, url: null, provider: res.provider });
    console.log(`\n${text}  [${res.provider}]`);
    for (const t of out.tasks) {
      console.log(
        `  - ${t.title} | ${t.space}${t.space_uncertain ? '?' : ''} | ${t.collection_name ?? '-'} | ${t.deadline_at ?? '-'} | ${t.estimate_minutes ?? '-'}p | P${t.priority}`,
      );
    }
  } catch (e) {
    console.log(`\n${text}  FAILED: ${(e as Error).message}`);
  }
}
