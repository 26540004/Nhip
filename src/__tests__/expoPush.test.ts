import { sendExpoPush } from '../../supabase/functions/_shared/expo-push.ts';

describe('Expo push client', () => {
  it('chunks by 100 and reports unregistered devices', async () => {
    const calls: unknown[][] = [];
    const fetchFn = (async (_url: string, init: { body: string }) => {
      const msgs = JSON.parse(init.body) as { to: string }[];
      calls.push(msgs);
      return new Response(
        JSON.stringify({
          data: msgs.map((m) =>
            m.to === 'ExponentPushToken[dead]' ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'x' },
          ),
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const messages = Array.from({ length: 150 }, (_, i) => ({
      to: i === 120 ? 'ExponentPushToken[dead]' : `ExponentPushToken[${i}]`,
      title: 't',
      body: 'b',
      data: {},
    }));
    const res = await sendExpoPush(messages, { fetchFn });
    expect(calls.map((c) => c.length)).toEqual([100, 50]);
    expect(res).toEqual({ sent: 149, invalidTokens: ['ExponentPushToken[dead]'] });
  });
});
