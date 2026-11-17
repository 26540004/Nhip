import {
  checkUrl,
  decodeEntities,
  fetchPreview,
  isPrivateIp,
  parsePreview,
  PreviewError,
} from '../../supabase/functions/_shared/link-preview-core.ts';

const html = (head: string, status = 200, type = 'text/html; charset=utf-8') =>
  new Response(`<!doctype html><html><head>${head}</head><body>x</body></html>`, { status, headers: { 'content-type': type } });

describe('link preview safety', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ])('private address %s is blocked', (ip) => expect(isPrivateIp(ip)).toBe(true));
  it('public addresses pass', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('2606:4700::1111')).toBe(false);
  });
  it.each([
    'ftp://example.com',
    'http://localhost/x',
    'http://printer.local',
    'http://user:pw@example.com',
    'http://example.com:8080',
    'http://2130706433/',
    'http://[::1]/',
    'javascript:alert(1)',
    'not a url',
  ])('rejects %s', (u) => expect(() => checkUrl(u)).toThrow(PreviewError));

  it('rejects hosts that resolve to private IPs and checks every redirect hop', async () => {
    const resolveHost = async (h: string) => (h === 'evil.example' ? ['10.0.0.5'] : ['93.184.216.34']);
    const fetchFn = jest.fn(async () => html(''));
    await expect(fetchPreview('https://evil.example/', { fetchFn, resolveHost })).rejects.toMatchObject({ code: 'blocked' });
    expect(fetchFn).not.toHaveBeenCalled();

    const redirecting = jest.fn(async (url: string) =>
      url.startsWith('https://ok.example')
        ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } })
        : html(''),
    );
    await expect(fetchPreview('https://ok.example/a', { fetchFn: redirecting as never, resolveHost })).rejects.toMatchObject({
      code: 'blocked',
    });
    expect(redirecting).toHaveBeenCalledTimes(1);
  });

  it('times out after the budget', async () => {
    const fetchFn = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    await expect(
      fetchPreview('https://slow.example', { fetchFn: fetchFn as never, resolveHost: async () => ['1.1.1.1'], timeoutMs: 30 }),
    ).rejects.toMatchObject({
      code: 'timeout',
    });
  });
});

describe('link preview parsing', () => {
  it('prefers Open Graph, decodes entities, strips tags, resolves relative images', () => {
    const p = parsePreview(
      `<title>Fallback</title>
       <meta property="og:title" content="Giáo trình &amp; bài giảng &#8211; Mạng máy tính">
       <meta name="description" content="<b>Chương 3</b>:   TCP/IP&nbsp;cơ bản">
       <meta property="og:image" content="/img/cover.png">
       <meta property="og:site_name" content='UIT'>`,
      'https://courses.uit.edu.vn/course/view.php?id=1',
    );
    expect(p).toEqual({
      url: 'https://courses.uit.edu.vn/course/view.php?id=1',
      title: 'Giáo trình & bài giảng – Mạng máy tính',
      description: 'Chương 3 : TCP/IP cơ bản',
      image: 'https://courses.uit.edu.vn/img/cover.png',
      site_name: 'UIT',
    });
  });

  it('drops non-https images and caps lengths; falls back to <title> and hostname', () => {
    const long = 'a'.repeat(500);
    const p = parsePreview(`<title>${long}</title><meta property="og:image" content="http://x.example/i.png">`, 'https://www.example.com/');
    expect(p.title!.length).toBeLessThanOrEqual(200);
    expect(p.image).toBeNull();
    expect(p.site_name).toBe('example.com');
    expect(decodeEntities('&lt;script&gt;&#x1F600;')).toBe('<script>😀');
  });

  it('follows safe redirects and handles non-HTML documents', async () => {
    const resolveHost = async () => ['93.184.216.34'];
    const fetchFn = jest.fn(async (url: string) => {
      if (url === 'https://short.example/x')
        return new Response(null, { status: 301, headers: { location: 'https://docs.example/file.pdf' } });
      return new Response('%PDF', { headers: { 'content-type': 'application/pdf' } });
    });
    const p = await fetchPreview('https://short.example/x', { fetchFn: fetchFn as never, resolveHost });
    expect(p).toMatchObject({ url: 'https://docs.example/file.pdf', title: 'file.pdf', site_name: 'docs.example' });
  });
});
