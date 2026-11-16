import { routeFromUrl } from '../lib/notifications/links';

describe('notification deep links', () => {
  it.each([
    ['nhip://task/0b3c2d1e-aaaa-4bbb-8ccc-111111111111', '/task/0b3c2d1e-aaaa-4bbb-8ccc-111111111111'],
    ['nhip://brief', '/brief'],
    ['nhip://review', '/review'],
    ['nhip://something/else', '/'],
  ])('%s → %s', (url, path) => {
    expect(routeFromUrl(url)).toBe(path);
  });
  it('ignores non-app URLs', () => {
    expect(routeFromUrl('https://evil.example')).toBeNull();
    expect(routeFromUrl(42)).toBeNull();
  });
});
