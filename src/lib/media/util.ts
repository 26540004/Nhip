/** Small pure helpers for media (unit-tested). */

/** Target size keeping the aspect ratio; null when no resize is needed. */
export function fitWithin(width: number, height: number, max: number): { width: number } | { height: number } | null {
  if (width <= max && height <= max) return null;
  return width >= height ? { width: max } : { height: max };
}

/** "uit.edu.vn/x" → "https://uit.edu.vn/x"; anything that is not http(s) → null. */
export function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(s) ? `https://${s}` : null;
  if (!withScheme) return null;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
