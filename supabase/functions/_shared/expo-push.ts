/** Expo Push Service client (fetch only; runs in Deno and Jest). */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound?: 'default';
  categoryId?: string;
}

export interface PushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Send in chunks of 100 (Expo's limit). Returns the tokens Expo says are no longer valid. */
export async function sendExpoPush(
  messages: PushMessage[],
  opts: { accessToken?: string; fetchFn?: typeof fetch } = {},
): Promise<{ sent: number; invalidTokens: string[] }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const invalid: string[] = [];
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const res = await fetchFn('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {}),
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`expo push HTTP ${res.status}`);
    const json = (await res.json()) as { data?: PushTicket[] };
    (json.data ?? []).forEach((t, j) => {
      if (t.status === 'ok') sent++;
      else if (t.details?.error === 'DeviceNotRegistered') invalid.push(chunk[j]!.to);
    });
  }
  return { sent, invalidTokens: invalid };
}
