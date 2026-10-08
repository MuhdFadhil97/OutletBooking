/**
 * ToyyibPay HTTP API (https://toyyibpay.com/apireference/ · sandbox: https://dev.toyyibpay.com).
 * Every booking call uses the BUSINESS's own secret key, so money goes straight to the business.
 * Requests are form-encoded POSTs; answers are JSON arrays (or a bare error string).
 */
export interface CreateBillInput {
  categoryCode: string;
  /** Shown on ToyyibPay's page. Letters, digits, spaces and `_` only — cleaned here. Max 30. */
  name: string;
  /** Max 100, same characters as name. */
  description: string;
  amountSen: number;
  returnUrl: string;
  callbackUrl: string;
  /** Our reference, sent back as `order_id`. */
  externalRef: string;
  payerName: string;
  payerEmail?: string | null;
  payerPhone?: string | null;
}

/** One row of getBillTransactions. `billpaymentStatus`: 1 paid · 2 pending · 3 failed · 4 pending. */
export interface BillTransaction {
  status: 'paid' | 'pending' | 'failed';
  amountSen: number;
  invoiceNo: string | null;
  channel: string | null;
  paidAt: string | null;
}

export interface ToyyibPayClient {
  /** Creates a category; also proves the secret key works. Returns the CategoryCode. */
  createCategory(secretKey: string, name: string, description: string): Promise<string>;
  /** Returns the BillCode. */
  createBill(secretKey: string, input: CreateBillInput): Promise<string>;
  getBillTransactions(billCode: string): Promise<BillTransaction[]>;
  paymentUrl(billCode: string): string;
}

export class ToyyibPayError extends Error {}

/** ToyyibPay rejects anything but letters, digits, spaces and underscores in bill names. */
export const billText = (s: string, max: number) =>
  s
    .replace(/[^A-Za-z0-9 _]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim() || 'Booking';

const phoneDigits = (p: string) => p.replace(/^\+?60/, '0').replace(/\D/g, '');

export function createToyyibPay(baseUrl: string, fetchFn: typeof fetch = fetch): ToyyibPayClient {
  const base = baseUrl.replace(/\/+$/, '');

  async function post(path: string, fields: Record<string, string>): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchFn(`${base}/index.php/api/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      });
    } catch {
      throw new ToyyibPayError('Could not reach ToyyibPay. Try again in a minute.');
    }
    const text = await res.text();
    if (!res.ok) throw new ToyyibPayError(`ToyyibPay error (${res.status})`);
    try {
      return JSON.parse(text);
    } catch {
      // e.g. "[KEY-DID-NOT-EXIST]" — never echo more than a short snippet.
      throw new ToyyibPayError(`ToyyibPay said: ${text.slice(0, 120)}`);
    }
  }

  const first = (data: unknown): Record<string, unknown> | null =>
    Array.isArray(data) && data[0] && typeof data[0] === 'object' ? (data[0] as Record<string, unknown>) : null;

  const errorOf = (data: unknown): string => {
    const row = first(data) ?? (data && typeof data === 'object' ? (data as Record<string, unknown>) : null);
    const msg = row?.msg ?? row?.message ?? row?.status;
    return typeof msg === 'string' ? msg : 'unexpected answer';
  };

  return {
    async createCategory(secretKey, name, description) {
      const data = await post('createCategory', {
        catname: billText(name, 30),
        catdescription: billText(description, 100),
        userSecretKey: secretKey,
      });
      const code = first(data)?.CategoryCode;
      if (typeof code !== 'string' || !code) throw new ToyyibPayError(`ToyyibPay did not accept this key (${errorOf(data)})`);
      return code;
    },

    async createBill(secretKey, b) {
      const data = await post('createBill', {
        userSecretKey: secretKey,
        categoryCode: b.categoryCode,
        billName: billText(b.name, 30),
        billDescription: billText(b.description, 100),
        billPriceSetting: '1', // fixed amount
        billPayorInfo: '1',
        billAmount: String(b.amountSen), // in sen
        billReturnUrl: b.returnUrl,
        billCallbackUrl: b.callbackUrl,
        billExternalReferenceNo: b.externalRef,
        billTo: b.payerName.slice(0, 100),
        billEmail: b.payerEmail || 'noreply@outletbooking.my',
        billPhone: b.payerPhone ? phoneDigits(b.payerPhone) : '0000000000',
        billSplitPayment: '0',
        billSplitPaymentArgs: '',
        billPaymentChannel: '0', // FPX online banking
        billContentEmail: 'Thank you for your booking.',
        billChargeToCustomer: '', // fees on the business (ToyyibPay default)
      });
      const code = first(data)?.BillCode;
      if (typeof code !== 'string' || !code) throw new ToyyibPayError(`Could not create the payment (${errorOf(data)})`);
      return code;
    },

    async getBillTransactions(billCode) {
      const data = await post('getBillTransactions', { billCode });
      if (!Array.isArray(data)) return [];
      return data
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r) => {
          const code = Number(r.billpaymentStatus);
          const amount = Number.parseFloat(String(r.billpaymentAmount ?? '0'));
          return {
            status: code === 1 ? 'paid' : code === 3 ? 'failed' : 'pending',
            amountSen: Number.isFinite(amount) ? Math.round(amount * 100) : 0,
            invoiceNo: typeof r.billpaymentInvoiceNo === 'string' ? r.billpaymentInvoiceNo : null,
            channel: typeof r.billpaymentChannel === 'string' ? r.billpaymentChannel : null,
            paidAt: typeof r.billPaymentDate === 'string' ? r.billPaymentDate : null,
          } satisfies BillTransaction;
        });
    },

    paymentUrl: (billCode) => `${base}/${billCode}`,
  };
}
