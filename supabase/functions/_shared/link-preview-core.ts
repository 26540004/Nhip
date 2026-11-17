/**
 * Link previews (pure; shared by the link-preview Edge Function and Jest).
 *
 * Safety:
 *  - Only http(s) on default ports, no credentials in the URL.
 *  - Hosts that are, or resolve to, loopback / private / link-local / metadata addresses are
 *    refused (SSRF). Every redirect hop is checked again (max 3 hops).
 *  - 5 s total timeout, only text/html, at most 512 KB read.
 *  - Output is plain text (tags stripped, entities decoded, whitespace collapsed, length
 *    capped); the image must be an https URL. Nothing from the page is ever rendered as HTML.
 */
export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
}

export class PreviewError extends Error {
  constructor(readonly code: 'blocked' | 'timeout' | 'http' | 'not_html' | 'network') {
    super(code);
    this.name = 'PreviewError';
  }
}

// ---------------------------------------------------------------------------
// Address checks
// ---------------------------------------------------------------------------

function ipv4Parts(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

export function isPrivateIp(ip: string): boolean {
  const v4 = ipv4Parts(ip);
  if (v4) {
    const [a, b] = v4 as [number, number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast, reserved, broadcast
    );
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (!v6.includes(':')) return false;
  if (v6 === '::' || v6 === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateIp(mapped[1]!);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
}

const BLOCKED_HOSTS = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i;

/** Syntactic checks; DNS is checked separately by the caller-supplied resolver. */
export function checkUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new PreviewError('blocked');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new PreviewError('blocked');
  if (u.username || u.password) throw new PreviewError('blocked');
  if (u.port && u.port !== '80' && u.port !== '443') throw new PreviewError('blocked');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || BLOCKED_HOSTS.test(host) || isPrivateIp(host)) throw new PreviewError('blocked');
  // Bare integers / hex hosts are alternative spellings of IPs ("http://2130706433").
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) throw new PreviewError('blocked');
  u.hash = '';
  return u;
}

// ---------------------------------------------------------------------------
// HTML → preview
// ---------------------------------------------------------------------------

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return NAMED[code.toLowerCase()] ?? all;
  });
}

function clean(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  const text = decodeEntities(s.replace(/<[^>]*>/g, ' '))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? null) : null;
}

export function parsePreview(html: string, pageUrl: string): LinkPreview {
  const head = html.slice(0, 300_000);
  const meta = new Map<string, string>();
  for (const m of head.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const tag = m[0];
    const key = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase();
    const content = attr(tag, 'content');
    if (key && content != null && !meta.has(key)) meta.set(key, content);
  }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? null;
  const title = clean(meta.get('og:title') ?? meta.get('twitter:title') ?? titleTag, 200);
  const description = clean(meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description'), 300);
  const siteName = clean(meta.get('og:site_name'), 80) ?? new URL(pageUrl).hostname.replace(/^www\./, '');

  let image: string | null = null;
  const rawImage = meta.get('og:image:secure_url') ?? meta.get('og:image') ?? meta.get('twitter:image');
  if (rawImage) {
    try {
      const abs = new URL(decodeEntities(rawImage.trim()), pageUrl);
      if (abs.protocol === 'https:' && abs.href.length <= 1000) image = abs.href;
    } catch {
      image = null;
    }
  }
  return { url: pageUrl, title, description, image, site_name: siteName };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

export interface FetchPreviewDeps {
  fetchFn: typeof fetch;
  /** Resolve a hostname to IPs (Deno.resolveDns). Return [] when unknown. */
  resolveHost: (host: string) => Promise<string[]>;
  timeoutMs?: number;
  maxBytes?: number;
}

async function assertPublic(u: URL, resolveHost: FetchPreviewDeps['resolveHost']): Promise<void> {
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (ipv4Parts(host) || host.includes(':')) return; // literal already checked
  const ips = await resolveHost(host);
  if (ips.length === 0 || ips.some(isPrivateIp)) throw new PreviewError('blocked');
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const buf = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, buf.length - off);
    buf.set(c.subarray(0, take), off);
    off += take;
    if (off >= buf.length) break;
  }
  const charset = /charset=([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

export async function fetchPreview(rawUrl: string, deps: FetchPreviewDeps): Promise<LinkPreview> {
  const timeoutMs = deps.timeoutMs ?? 5000;
  const maxBytes = deps.maxBytes ?? 512 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let url = checkUrl(rawUrl);
    for (let hop = 0; hop <= 3; hop++) {
      await assertPublic(url, deps.resolveHost);
      let res: Response;
      try {
        res = await deps.fetchFn(url.href, {
          redirect: 'manual',
          signal: controller.signal,
          headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'NhipLinkPreview/1.0 (+https://nhip.app)' },
        });
      } catch {
        throw new PreviewError(controller.signal.aborted ? 'timeout' : 'network');
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!loc || hop === 3) throw new PreviewError('http');
        url = checkUrl(new URL(loc, url).href);
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new PreviewError('http');
      }
      const type = res.headers.get('content-type') ?? '';
      if (!/text\/html|application\/xhtml/i.test(type)) {
        await res.body?.cancel().catch(() => undefined);
        // Not a page (PDF, image…): still a useful card with the file name.
        const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '') || null;
        return { url: url.href, title: clean(name, 200), description: null, image: null, site_name: url.hostname.replace(/^www\./, '') };
      }
      let html: string;
      try {
        html = await readLimited(res, maxBytes);
      } catch {
        throw new PreviewError(controller.signal.aborted ? 'timeout' : 'network');
      }
      return parsePreview(html, url.href);
    }
    throw new PreviewError('http');
  } finally {
    clearTimeout(timer);
  }
}
