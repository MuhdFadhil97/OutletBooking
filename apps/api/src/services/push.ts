/**
 * Outgoing push through Expo's push service (https://docs.expo.dev/push-notifications/sending-notifications/).
 * Best-effort: the in-app notification row is the record; push is an extra.
 *  - `expo`: HTTP API — development, staging, production.
 *  - `off`: drops messages — tests.
 */
export interface PushMessage {
  to: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}

export interface PushResult {
  /** Tokens Expo reports as no longer registered — delete them. */
  deadTokens: string[];
}

export interface PushSender {
  send(messages: PushMessage[]): Promise<PushResult>;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts up to 100 messages per request. */
const BATCH = 100;

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

export function createPushSender(
  config: { NODE_ENV: string; PUSH_TRANSPORT?: 'expo' | 'off' },
  fetchFn: typeof fetch = fetch,
): PushSender {
  const transport = config.PUSH_TRANSPORT ?? (config.NODE_ENV === 'test' ? 'off' : 'expo');
  if (transport === 'off') return { send: async () => ({ deadTokens: [] }) };

  return {
    async send(messages) {
      const deadTokens: string[] = [];
      for (let i = 0; i < messages.length; i += BATCH) {
        const batch = messages.slice(i, i + BATCH).map((m) => ({ ...m, sound: 'default' }));
        const res = await fetchFn(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify(batch),
        });
        if (!res.ok) throw new Error(`Expo push rejected the request (${res.status}): ${(await res.text()).slice(0, 300)}`);
        const { data } = (await res.json()) as { data?: ExpoTicket[] };
        data?.forEach((ticket, j) => {
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') deadTokens.push(batch[j]!.to);
        });
      }
      return { deadTokens };
    },
  };
}
