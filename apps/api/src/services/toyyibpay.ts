import { createHash } from 'node:crypto';

/**
 * ToyyibPay API (https://toyyibpay.com/apireference). Sandbox: https://dev.toyyibpay.com.
 * All calls are form-encoded POSTs. Every business uses its OWN User Secret Key.
 * Tests pass a fake implementing `ToyyibPayClient`.
 */

export interface CreateBillInput {
  userSecretKey: string;
  categoryCode: string;
  /** Max 30 chars: letters, numbers, space, "_". */
  billName: string;
  /** Max 100 chars: letters, numbers, space, "_". */
  billDescription: string;
  amountSen: number;
  returnUrl: string;
  callbackUrl: string;
  /** Shown to the payer and returned as `order_id`. */
  externalReferenceNo: string;
  billTo: string;
  billEmail: string;
  billPhone: string;
  /** Bill stops accepting payment after this (pending hold). */
  expiresAt?: Date;
}

export interface BillTransaction {
  /** '1' success, '2' pending, '3' unsuccessful, '4' pending. */
  billpaymentStatus: string;
  /** Ringgit, e.g. "60.00". */
  billpaymentAmount: string;
  billpaymentInvoiceNo: string;
  billPaymentDate?: string;
  billpaymentChannel?: string;
  billExternalReferenceNo?: string;
}

export interface ToyyibPayClient {
  createCategory(userSecretKey: string, name: string, description: string): Promise<string>;
  createBill(input: CreateBillInput): Promise<string>;
  getBillTransactions(billCode: string): Promise<BillTransaction[]>;
  paymentUrl(billCode: string): string;
}

/** A ToyyibPay error we can show the owner (wrong key, bad input). */
export class ToyyibPayError extends Error {}

/** ToyyibPay text fields: letters, numbers, space and "_" only. */
export const toyyibText = (s: string, max: number) =>
  s
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 _]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();

/** "17-12-2020 17:00:00" in Malaysia time (ToyyibPay's format). */
function expiryText(d: Date): string {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${v('day')}-${v('month')}-${v('year')} ${v('hour')}:${v('minute')}:${v('second')}`;
}

/** Callback `hash` = MD5(userSecretKey + status + order_id + refno + "ok"). */
export function callbackHash(userSecretKey: string, status: string, orderId: string, refno: string): string {
  return createHash('md5').update(`${userSecretKey}${status}${orderId}${refno}ok`).digest('hex');
}

export function toyyibPayClient(baseUrl: string, fetchImpl: typeof fetch = fetch): ToyyibPayClient {
  const base = baseUrl.replace(/\/+$/, '');

  async function call(path: string, form: Record<string, string>): Promise<unknown> {
    const res = await fetchImpl(`${base}/index.php/api/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`ToyyibPay ${path} failed: ${res.status} ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text);
    } catch {
      // Errors come back as plain text, e.g. "[KEY-DID-NOT-EXIST]".
      throw new ToyyibPayError(text.trim().slice(0, 200) || `ToyyibPay ${path} failed`);
    }
  }

  const firstField = (data: unknown, field: string): string => {
    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    const value = row?.[field];
    if (typeof value === 'string' && value) return value;
    const msg = (data as { msg?: unknown } | null)?.msg;
    throw new ToyyibPayError(typeof msg === 'string' ? msg : `Unexpected ToyyibPay response: ${JSON.stringify(data).slice(0, 200)}`);
  };

  return {
    async createCategory(userSecretKey, name, description) {
      const data = await call('createCategory', { userSecretKey, catname: name, catdescription: description });
      return firstField(data, 'CategoryCode');
    },
    async createBill(i) {
      const data = await call('createBill', {
        userSecretKey: i.userSecretKey,
        categoryCode: i.categoryCode,
        billName: toyyibText(i.billName, 30) || 'Booking',
        billDescription: toyyibText(i.billDescription, 100) || 'Booking',
        billPriceSetting: '1',
        billPayorInfo: '1',
        billAmount: String(i.amountSen),
        billReturnUrl: i.returnUrl,
        billCallbackUrl: i.callbackUrl,
        billExternalReferenceNo: i.externalReferenceNo,
        billTo: i.billTo,
        billEmail: i.billEmail,
        billPhone: i.billPhone,
        // FPX only; the business pays ToyyibPay's fee (blank = charged to the bill owner).
        billPaymentChannel: '0',
        billChargeToCustomer: '',
        ...(i.expiresAt ? { billExpiryDate: expiryText(i.expiresAt) } : {}),
      });
      return firstField(data, 'BillCode');
    },
    async getBillTransactions(billCode) {
      try {
        const data = await call('getBillTransactions', { billCode });
        return Array.isArray(data) ? (data as BillTransaction[]) : [];
      } catch (err) {
        // A bill nobody has paid yet answers with plain text "No data found!".
        if (err instanceof ToyyibPayError && /no data found/i.test(err.message)) return [];
        throw err;
      }
    },
    paymentUrl: (billCode) => `${base}/${billCode}`,
  };
}

/** "60.00" → 6000 */
export const ringgitToSen = (s: string) => Math.round(Number.parseFloat(s) * 100);
