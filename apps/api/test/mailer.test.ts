import { describe, expect, it } from 'vitest';
import { createMailer } from '../src/services/mailer';

const message = { to: 'owner@example.com', subject: 'Reset your password', text: 'Link: https://x/reset?token=abc' };

/** Fake fetch that records the request and answers with `status`. */
function fakeFetch(status = 200, body = '{"id":"em_1"}') {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status });
  }) as typeof fetch;
  return { fn, calls };
}

describe('Resend mailer', () => {
  const config = {
    NODE_ENV: 'production',
    MAIL_TRANSPORT: 'resend' as const,
    MAIL_FROM: 'OutletBooking <no-reply@outletbooking.my>',
    RESEND_API_KEY: 're_test_key',
  };

  it('posts the email to the Resend API with the key as a bearer token', async () => {
    const { fn, calls } = fakeFetch();
    await createMailer(config, fn).send(message);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer re_test_key');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      from: 'OutletBooking <no-reply@outletbooking.my>',
      to: ['owner@example.com'],
      subject: 'Reset your password',
      text: 'Link: https://x/reset?token=abc',
    });
  });

  it('throws when Resend rejects the email, without leaking the key or the link', async () => {
    const { fn } = fakeFetch(422, '{"message":"The from domain is not verified"}');
    const err = await createMailer(config, fn).send(message).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('422');
    expect((err as Error).message).toContain('not verified');
    expect((err as Error).message).not.toContain('re_test_key');
    expect((err as Error).message).not.toContain('token=abc');
  });

  it('needs an API key and a sender', () => {
    expect(() => createMailer({ ...config, RESEND_API_KEY: undefined })).toThrow(/RESEND_API_KEY/);
    expect(() => createMailer({ ...config, MAIL_FROM: undefined })).toThrow(/MAIL_FROM/);
  });

  it('console transport is refused in production', () => {
    expect(() => createMailer({ NODE_ENV: 'production', MAIL_TRANSPORT: 'console' })).toThrow(/production/);
  });
});
