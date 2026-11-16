/** Client-side URL extraction (same rule as the server's parse-task-core.extractUrl). */
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/i;

export function extractUrlClient(text: string): { url: string | null; rest: string } {
  const m = URL_RE.exec(text);
  if (!m) return { url: null, rest: text };
  const url = m[0].replace(/[).,;]+$/, '');
  return { url, rest: (text.slice(0, m.index) + text.slice(m.index + url.length)).replace(/\s+/g, ' ').trim() };
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
