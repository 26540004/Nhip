/** 'nhip://task/abc' → '/task/abc', 'nhip://brief' → '/brief'; unknown app paths → '/'; other URLs → null. */
export function routeFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith('nhip://')) return null;
  const path = `/${url.slice('nhip://'.length).replace(/^\/+/, '')}`;
  return /^\/(task\/[\w-]+|brief|review|plan(\?.*)?|calendar|tasks|notes)$/.test(path) ? path : '/';
}
