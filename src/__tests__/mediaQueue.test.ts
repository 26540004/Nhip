import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import {
  MAX_UPLOAD_ATTEMPTS,
  mergeKick,
  nextDueJob,
  nextWakeAt,
  pendingUploads,
  uploadBackoffMs,
  type UploadJob,
} from '../lib/media/queue';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

const job = (path: string, nextAt: number, attempts = 0): UploadJob => ({
  path,
  localUri: `file:///${path}`,
  contentType: 'image/jpeg',
  attempts,
  nextAt,
});

describe('media upload queue', () => {
  it('backs off exponentially up to 10 minutes', () => {
    expect([1, 2, 3, 4].map(uploadBackoffMs)).toEqual([5000, 10000, 20000, 40000]);
    expect(uploadBackoffMs(20)).toBe(600_000);
  });

  it('picks the earliest due job and skips exhausted ones', () => {
    const jobs = [job('a', 300), job('b', 100), job('c', 50, MAX_UPLOAD_ATTEMPTS), job('d', 900)];
    expect(nextDueJob(jobs, 500)?.path).toBe('b');
    expect(nextDueJob(jobs, 80)).toBeNull();
    expect(nextWakeAt(jobs)).toBe(100);
    expect(pendingUploads(jobs)).toBe(3);
    expect(pendingUploads(jobs, 'd')).toBe(1);
  });

  it('a start request is never downgraded to a nudge', () => {
    expect(mergeKick(undefined, 'process')).toBe('process');
    expect(mergeKick('start', 'process')).toBe('start');
    expect(mergeKick('process', 'start')).toBe('start');
  });
});
