import { report, reportException, reportFunctionError, setAutoReport, setReporterAdmin, setReporterRoute } from '../lib/errors/reporter';

const mockInvoke = jest.fn().mockResolvedValue({ data: { issue: 7 }, error: null });
jest.mock('../lib/api/supabase', () => ({ requireSupabase: () => ({ functions: { invoke: mockInvoke } }) }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn().mockResolvedValue(null), setItem: jest.fn() }));
jest.mock('expo-constants', () => ({ expoConfig: { version: '1.2.3' } }));


const flush = () => new Promise((r) => setTimeout(r, 0));

describe('error reporter (admin only)', () => {
  beforeEach(() => mockInvoke.mockClear());

  it('sends nothing for non-admin users, even manual reports', async () => {
    setReporterAdmin(false);
    reportException(new Error('boom'));
    expect(await report({ kind: 'manual', message: 'x', description: 'y' }, { manual: true })).toBeNull();
    await flush();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('admin: reports unexpected errors once, scrubbed, with the screen pattern', async () => {
    setReporterAdmin(true);
    await setAutoReport(true);
    setReporterRoute('/task/3f2b8c1e-1234-4abc-9def-0123456789ab');
    reportException(new TypeError('x is undefined for me@x.vn'));
    reportException(new TypeError('x is undefined for you@x.vn')); // same bug → not sent twice
    await flush();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const body = mockInvoke.mock.calls[0][1].body;
    expect(body).toMatchObject({ kind: 'error', route: '/task/[id]', app_version: '1.2.3' });
    expect(body.message).not.toContain('me@x.vn');
  });

  it('ignores expected conditions (offline, AI quota, 4xx) and network blips', async () => {
    setReporterAdmin(true);
    reportFunctionError('parse-task', 'ai_unavailable', 503);
    reportFunctionError('parse-task', 'bad_request', 400);
    reportFunctionError('report-error', 'internal', 500); // never report the reporter
    reportException(Object.assign(new Error('offline'), { code: 'offline' }));
    reportException(new TypeError('Network request failed'));
    await flush();
    expect(mockInvoke).not.toHaveBeenCalled();
    reportFunctionError('propose-plan', 'internal', 500, 'boom');
    await flush();
    expect(mockInvoke.mock.calls[0][1].body).toMatchObject({ kind: 'function', fn: 'propose-plan', status: 500 });
  });

  it('respects the admin turning automatic reports off, but manual still works', async () => {
    setReporterAdmin(true);
    await setAutoReport(false);
    reportException(new Error('a brand new bug'));
    await flush();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(await report({ kind: 'manual', message: 'Báo lỗi thủ công', description: 'lỗi lịch' }, { manual: true })).toEqual({ issue: 7 });
  });
});
