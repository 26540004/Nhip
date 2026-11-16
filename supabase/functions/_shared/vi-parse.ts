/**
 * Deterministic Vietnamese date / time / duration resolution.
 *
 * Pure TypeScript with no imports, so it runs in Deno (Edge Functions) and in Jest.
 * The AI segments a sentence into tasks and returns the exact phrases it used for the
 * deadline and the estimate; this module turns those phrases into instants and minutes.
 * Date arithmetic is never left to the model.
 *
 * Conventions (documented in README):
 *  - A date without a time → 23:59 local that day.
 *  - Part of day without a time → end of that part: sáng 12:00, trưa 13:00, chiều 18:00, tối 22:00, đêm 23:59.
 *  - Hour 1–6 without sáng/chiều/tối → afternoon ("họp 2h" = 14:00).
 *  - A time without a date → today if still ahead, else tomorrow.
 *  - "thứ 6" / "thứ 6 này" → the next such weekday (today counts). "thứ 6 tuần sau/tới" → that weekday next week (weeks start Monday).
 *  - "cuối tuần" → Sunday of this week; "tuần sau" alone → Sunday of next week.
 *  - "đầu tháng sau" → day 1 of next month; "cuối tháng" → last day of this month.
 */

export interface LocalDate {
  y: number;
  m: number; // 1–12
  d: number;
}

export interface ResolvedDeadline {
  /** ISO 8601 with local offset, e.g. 2026-11-20T23:59:00+07:00 */
  iso: string;
  /** True when the phrase contained an explicit clock time. */
  hasTime: boolean;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Lowercase, strip Vietnamese diacritics, đ → d, collapse spaces. */
export function normalizeVi(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Calendar helpers (timezone via Intl, no external libs)
// ---------------------------------------------------------------------------

function localParts(instant: number, tz: string): LocalDate & { hh: number; mm: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(instant))) p[part.type] = part.value;
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday ?? '');
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour) % 24, mm: Number(p.minute), weekday: wd };
}

function offsetMinutesAt(instant: number, tz: string): number {
  const lp = localParts(instant, tz);
  const asUtc = Date.UTC(lp.y, lp.m - 1, lp.d, lp.hh, lp.mm);
  return Math.round((asUtc - Math.floor(instant / 60000) * 60000) / 60000);
}

/** Instant for a local wall-clock time in `tz`. */
export function localToInstantTz(date: LocalDate, hh: number, mm: number, tz: string): number {
  const naive = Date.UTC(date.y, date.m - 1, date.d, hh, mm);
  let guess = naive - offsetMinutesAt(naive, tz) * 60000;
  guess = naive - offsetMinutesAt(guess, tz) * 60000; // settle across DST edges
  return guess;
}

export function formatIsoTz(instant: number, tz: string): string {
  const off = offsetMinutesAt(instant, tz);
  const lp = localParts(instant, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${lp.y}-${pad(lp.m)}-${pad(lp.d)}T${pad(lp.hh)}:${pad(lp.mm)}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

function addDays(date: LocalDate, n: number): LocalDate {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function weekdayOf(date: LocalDate): number {
  return new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function cmp(a: LocalDate, b: LocalDate): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

// ---------------------------------------------------------------------------
// Phrase patterns (all matched on normalized text)
// ---------------------------------------------------------------------------

const WEEKDAY_WORDS: Record<string, number> = {
  hai: 1,
  ba: 2,
  tu: 3,
  nam: 4,
  sau: 5,
  bay: 6,
  '2': 1,
  '3': 2,
  '4': 3,
  '5': 4,
  '6': 5,
  '7': 6,
};

type DayPart = 'sang' | 'trua' | 'chieu' | 'toi' | 'dem';
const DAY_PART_END: Record<DayPart, [number, number]> = {
  sang: [12, 0],
  trua: [13, 0],
  chieu: [18, 0],
  toi: [22, 0],
  dem: [23, 59],
};

function findDayPart(s: string): DayPart | null {
  // "tuần tới" / "tháng tới" also normalize to "toi" — they are not "tối" (evening).
  const cleaned = s.replace(/\b(tuan|thang|lan|nam)\s+toi\b/g, ' ');
  const m = /\b(sang|trua|chieu|toi|dem)\b/.exec(cleaned);
  return (m?.[1] as DayPart | undefined) ?? null;
}

/** Explicit clock time: 17h, 17:30, 5h30, 5 gio chieu, 5 ruoi chieu, 9h toi. */
export function parseClockTime(s: string): { hh: number; mm: number } | null {
  const re = /\b(\d{1,2})\s*(?:h|g|gio|:)\s*(\d{1,2})?(?:\s*(?:phut|p))?(?:\s*(ruoi))?|\b(\d{1,2})\s+(ruoi)\b/;
  const m = re.exec(s);
  if (!m) return null;
  let hh = Number(m[1] ?? m[4]);
  let mm = m[2] != null ? Number(m[2]) : 0;
  if (m[3] || m[5]) mm = 30;
  if (hh > 24 || mm > 59) return null;

  // Ignore numbers that are durations ("mat 2h", "3 tieng") — caller passes date phrases,
  // but be defensive about "trong 2h".
  const before = s.slice(0, m.index);
  if (/\b(mat|khoang|trong)\s*$/.test(before)) return null;

  const part = findDayPart(s.slice(m.index));
  const partBefore = findDayPart(before);
  const p = part ?? partBefore;
  if (p === 'chieu' || p === 'toi') {
    if (hh < 12) hh += 12;
  } else if (p === 'dem') {
    if (hh >= 6 && hh < 12) hh += 12;
  } else if (p === 'trua') {
    if (hh < 3) hh += 12;
  } else if (p == null) {
    if (hh >= 1 && hh <= 6) hh += 12;
  }
  if (hh === 24) ((hh = 23), (mm = 59));
  return { hh, mm };
}

/** Resolve the calendar date of a phrase relative to `today`. Null when no date words. */
export function parseDatePart(s: string, today: LocalDate): LocalDate | null {
  const todayWd = weekdayOf(today);

  // Explicit dd/mm(/yyyy) or dd-mm.
  let m = /\b(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(\d{2,4}))?\b/.exec(s);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : today.y;
    if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo)) {
      let out = { y, m: mo, d };
      if (!m[3] && cmp(out, today) < 0) out = { y: y + 1, m: mo, d }; // "5/1" in November → next year
      return out;
    }
  }

  // "ngay 5 thang 12", "ngay 20" (this month, or next month if passed).
  m = /\bngay\s+(\d{1,2})(?:\s+thang\s+(\d{1,2}))?\b/.exec(s);
  if (m) {
    const d = Number(m[1]);
    if (m[2]) {
      const mo = Number(m[2]);
      let y = today.y;
      if (mo < today.m || (mo === today.m && d < today.d)) y += 1;
      if (d <= daysInMonth(y, mo)) return { y, m: mo, d };
    } else {
      let y = today.y;
      let mo = today.m;
      if (d < today.d) {
        mo += 1;
        if (mo > 12) ((mo = 1), (y += 1));
      }
      if (d <= daysInMonth(y, mo)) return { y, m: mo, d };
    }
  }

  if (/\b(hom nay|toi nay|sang nay|chieu nay|trua nay|dem nay)\b/.test(s)) return today;
  // "mốt" normalizes to "mot", which is also "một" (one): only count it when not followed by a unit.
  if (/\b(ngay kia|ngay mot)\b/.test(s) || /\bmot\b(?!\s+(tieng|gio|ngay|tuan|thang|lan|chut|phut|nua|buoi))/.test(s)) {
    return addDays(today, 2);
  }
  if (/\b(ngay mai|mai)\b/.test(s)) return addDays(today, 1);

  m = /\b(\d{1,2})\s+ngay\s+nua\b|\btrong\s+(\d{1,2})\s+ngay\b/.exec(s);
  if (m) return addDays(today, Number(m[1] ?? m[2]));

  const nextWeek = /\btuan\s+(sau|toi)\b/.test(s);

  // Weekday: "thu 6", "thu sau", "t6", "chu nhat", "cn".
  m = /\b(?:thu\s+(hai|ba|tu|nam|sau|bay|[2-7])|t([2-7]))\b/.exec(s);
  const isSunday = /\b(chu nhat|cn)\b/.test(s);
  if (m || isSunday) {
    const target = isSunday ? 0 : (WEEKDAY_WORDS[m![1] ?? m![2] ?? ''] ?? -1);
    if (target >= 0) {
      // Monday-based index: Mon=0 … Sun=6.
      const mondayIdx = (wd: number) => (wd + 6) % 7;
      if (nextWeek) {
        const startNextWeek = addDays(today, 7 - mondayIdx(todayWd));
        return addDays(startNextWeek, mondayIdx(target));
      }
      return addDays(today, (target - todayWd + 7) % 7);
    }
  }

  if (/\bcuoi tuan\b/.test(s)) {
    const toSunday = (7 - todayWd) % 7;
    return addDays(today, toSunday + (nextWeek ? 7 : 0));
  }
  if (nextWeek) {
    const toSunday = (7 - todayWd) % 7;
    return addDays(today, toSunday + 7);
  }

  const nextMonth = /\bthang\s+(sau|toi)\b/.test(s);
  if (/\bdau thang\b/.test(s)) {
    let y = today.y;
    let mo = today.m + (nextMonth ? 1 : 0);
    if (mo > 12) ((mo = 1), (y += 1));
    // "dau thang" this month already passed → treat as next month.
    if (!nextMonth && today.d > 5) {
      mo += 1;
      if (mo > 12) ((mo = 1), (y += 1));
    }
    return { y, m: mo, d: 1 };
  }
  if (/\b(cuoi thang)\b/.test(s)) {
    let y = today.y;
    let mo = today.m + (nextMonth ? 1 : 0);
    if (mo > 12) ((mo = 1), (y += 1));
    return { y, m: mo, d: daysInMonth(y, mo) };
  }
  if (nextMonth) {
    let y = today.y;
    let mo = today.m + 1;
    if (mo > 12) ((mo = 1), (y += 1));
    return { y, m: mo, d: daysInMonth(y, mo) };
  }
  return null;
}

/**
 * Resolve a deadline phrase ("thứ 6 tuần sau", "trước 5h chiều mai", "tối nay") to an
 * instant. Returns null when the phrase has neither a date nor a time.
 */
export function resolveDeadline(phrase: string, now: number, tz: string): ResolvedDeadline | null {
  const s = normalizeVi(phrase);
  if (!s) return null;
  const lp = localParts(now, tz);
  const today: LocalDate = { y: lp.y, m: lp.m, d: lp.d };

  const date = parseDatePart(s, today);
  const time = parseClockTime(s);
  const part = findDayPart(s);

  if (!date && !time && !part) return null;

  let day = date ?? today;
  let hh: number;
  let mm: number;
  if (time) {
    hh = time.hh;
    mm = time.mm;
    if (!date) {
      const candidate = localToInstantTz(day, hh, mm, tz);
      if (candidate <= now) day = addDays(day, 1);
    }
  } else if (part) {
    [hh, mm] = DAY_PART_END[part];
    if (!date) {
      const candidate = localToInstantTz(day, hh, mm, tz);
      if (candidate <= now) day = addDays(day, 1);
    }
  } else {
    hh = 23;
    mm = 59;
  }
  return { iso: formatIsoTz(localToInstantTz(day, hh, mm, tz), tz), hasTime: Boolean(time) };
}

/** Duration phrase → minutes: "khoảng 3 tiếng", "45 phút", "1 tiếng rưỡi", "1h30", "nửa tiếng", "2 tiếng 15 phút". */
export function parseDurationMinutes(phrase: string): number | null {
  const s = normalizeVi(phrase);
  if (!s) return null;
  if (/\bnua\s+(tieng|gio)\b/.test(s)) return 30;
  if (/\bmot\s+(tieng|gio)\s+ruoi\b/.test(s)) return 90;

  let total: number;
  const hours = /(\d+(?:[.,]\d+)?)\s*(?:tieng|gio|hours?|h|g)(?![a-z])(?:\s*(ruoi))?/.exec(s);
  if (hours) {
    total = Math.round(Number(hours[1]!.replace(',', '.')) * 60) + (hours[2] ? 30 : 0);
    // Minutes right after the hours: "1h30", "2 tiếng 15 phút".
    const tail = s.slice(hours.index + hours[0].length);
    const mm = /^\s*(\d{1,2})(?:\s*(?:phut|ph|p|m))?(?![a-z\d])/.exec(tail);
    if (mm) total += Number(mm[1]);
  } else {
    const minutes = /(\d+)\s*(?:phut|ph|p|mins?|m)(?![a-z])/.exec(s);
    if (!minutes) return null;
    total = Number(minutes[1]);
  }
  return total > 0 && total <= 10000 ? total : null;
}

/** Best collection match: a collection whose normalized name appears in the text (longest wins). */
export function matchCollection<T extends { name: string }>(text: string, collections: readonly T[], hint?: string | null): T | null {
  const s = normalizeVi(text);
  const h = hint ? normalizeVi(hint) : null;
  let best: T | null = null;
  let bestLen = 0;
  for (const c of collections) {
    const n = normalizeVi(c.name);
    if (!n) continue;
    if (h && (h === n || n.includes(h) || h.includes(n))) return c;
    // also allow matching on the last word(s): "mon Mang" ↔ "Mạng máy tính"
    const firstWord = n.split(' ')[0]!;
    const hit = s.includes(n) ? n.length : firstWord.length >= 3 && new RegExp(`\\b${firstWord}\\b`).test(s) ? firstWord.length : 0;
    if (hit > bestLen) {
      best = c;
      bestLen = hit;
    }
  }
  return best;
}

const STUDY_WORDS =
  /\b(mon|bai tap|bai giang|thi|kiem tra|do an|tieu luan|hoc|on tap|giua ky|cuoi ky|lab|seminar|thuyet trinh mon|nop bai)\b/;
const WORK_WORDS =
  /\b(hop|khach hang|sep|du an|cong ty|hop dong|deadline cong viec|email|bao gia|team|phong ban|client|meeting|trien khai)\b/;

/** Keyword-based space guess used to double-check / back up the AI. Null when unclear. */
export function guessSpace(text: string): 'study' | 'work' | null {
  const s = normalizeVi(text);
  const study = STUDY_WORDS.test(s);
  const work = WORK_WORDS.test(s);
  if (study && !work) return 'study';
  if (work && !study) return 'work';
  return null;
}
