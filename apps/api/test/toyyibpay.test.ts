import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/services/secrets';
import { callbackHash, ringgitToSen, toyyibPayClient, ToyyibPayError, toyyibText } from '../src/services/toyyibpay';

/** The real ToyyibPay client against a fake fetch: request shape and response parsing. */
function fakeFetch(reply: string) {
  const calls: { url: string; form: Record<string, string> }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), form: Object.fromEntries(new URLSearchParams(String(init?.body))) });
    return new Response(reply, { status: 200 });
  }) as typeof fetch;
  return { fn, calls };
}

describe('toyyibPayClient', () => {
  it('createBill: FPX only, business pays the fee, fixed amount in sen, hold expiry in Malaysia time', async () => {
    const f = fakeFetch('[{"BillCode":"gcbhict9"}]');
    const client = toyyibPayClient('https://dev.toyyibpay.com/', f.fn);
    const code = await client.createBill({
      userSecretKey: 'k',
      categoryCode: 'cat',
      billName: 'Smash Arena PJ (Puchong)!',
      billDescription: 'Badminton · Sat 10 Oct 8 PM',
      amountSen: 6000,
      returnUrl: 'https://app/my-booking/t',
      callbackUrl: 'https://api/toyyibpay/callback',
      externalReferenceNo: 'AB12CD',
      billTo: 'Ali',
      billEmail: '',
      billPhone: '60123456789',
      expiresAt: new Date('2026-10-10T12:15:00Z'),
    });
    expect(code).toBe('gcbhict9');
    expect(f.calls[0]!.url).toBe('https://dev.toyyibpay.com/index.php/api/createBill');
    expect(f.calls[0]!.form).toMatchObject({
      billName: 'Smash Arena PJ Puchong',
      billDescription: 'Badminton Sat 10 Oct 8 PM',
      billPriceSetting: '1',
      billPayorInfo: '1',
      billAmount: '6000',
      billPaymentChannel: '0',
      billChargeToCustomer: '',
      billExternalReferenceNo: 'AB12CD',
      billExpiryDate: '10-10-2026 20:15:00',
    });
    expect(client.paymentUrl('gcbhict9')).toBe('https://dev.toyyibpay.com/gcbhict9');
  });

  it('plain-text errors (wrong key) become ToyyibPayError', async () => {
    const client = toyyibPayClient('https://dev.toyyibpay.com', fakeFetch('[KEY-DID-NOT-EXIST]').fn);
    await expect(client.createCategory('bad', 'n', 'd')).rejects.toBeInstanceOf(ToyyibPayError);
    const msg = toyyibPayClient('https://dev.toyyibpay.com', fakeFetch('{"status":"error","msg":"Invalid category"}').fn);
    await expect(msg.createCategory('k', 'n', 'd')).rejects.toThrow('Invalid category');
  });

  it('getBillTransactions returns [] for bills nobody has paid (real sandbox answer)', async () => {
    const client = toyyibPayClient('https://dev.toyyibpay.com', fakeFetch('				No data found!').fn);
    expect(await client.getBillTransactions('x')).toEqual([]);
    const broken = toyyibPayClient('https://dev.toyyibpay.com', fakeFetch('[KEY-DID-NOT-EXIST]').fn);
    await expect(broken.getBillTransactions('x')).rejects.toBeInstanceOf(ToyyibPayError);
  });

  it('helpers', () => {
    expect(toyyibText('Café & Court #1', 30)).toBe('Cafe Court 1');
    expect(ringgitToSen('60.00')).toBe(6000);
    expect(ringgitToSen('0.10')).toBe(10);
    expect(callbackHash('key', '1', 'AB12CD', 'TP1')).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('secrets (AES-256-GCM)', () => {
  const key = Buffer.alloc(32, 1).toString('base64');

  it('round-trips, never stores the plain text, and rejects tampering or the wrong key', () => {
    const stored = encryptSecret('my-secret-key', key);
    expect(stored).not.toContain('my-secret-key');
    expect(encryptSecret('my-secret-key', key)).not.toBe(stored); // random IV
    expect(decryptSecret(stored, key)).toBe('my-secret-key');
    const parts = stored.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
    expect(() => decryptSecret(stored, Buffer.alloc(32, 2).toString('base64'))).toThrow();
  });

  it('refuses to work without APP_ENCRYPTION_KEY', () => {
    expect(() => encryptSecret('x', undefined)).toThrow(/APP_ENCRYPTION_KEY/);
  });
});
