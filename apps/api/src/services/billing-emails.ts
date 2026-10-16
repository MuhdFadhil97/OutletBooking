import { formatInTimeZone } from 'date-fns-tz';
import { WEB_SIGN_IN_LINK_MINUTES } from '@outletbooking/shared';
import { renderEmail, type RenderedEmail } from './email-template';

const TZ = 'Asia/Kuala_Lumpur';

/** "RM 99.00" (receipts always show sen). */
export const rmText = (sen: number) => `RM ${(sen / 100).toFixed(2)}`;

/** M6 · One-time sign-in link to the plan payment pages on the website (docs/wireframes/Email-SignIn.dc.html). */
export function signInLinkEmail(url: string, websiteUrl: string): RenderedEmail {
  return renderEmail({
    subject: 'Your OutletBooking sign-in link',
    preview: 'Sign in to pay for your plan or see your receipts',
    heading: 'Sign in to OutletBooking billing',
    paragraphs: ['Use this link to pay for your plan or see your receipts. No password needed.'],
    button: { label: 'Sign in', url },
    notes: [
      `This link works once and expires in ${WEB_SIGN_IN_LINK_MINUTES} minutes.`,
      'Didn’t ask for this? Ignore this email — nobody can sign in without the link.',
    ],
    footer: 'Sent because a sign-in link was requested on outletbooking.my.',
    websiteUrl,
  });
}

/**
 * The plan period as people read it: "17 Oct – 16 Nov 2026". `end` is the instant the period ends
 * (start + 1 month), so the last day shown is the day before.
 */
export function periodText(start: Date, end: Date): string {
  const last = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const sameYear = formatInTimeZone(start, TZ, 'yyyy') === formatInTimeZone(last, TZ, 'yyyy');
  const from = formatInTimeZone(start, TZ, sameYear ? 'd MMM' : 'd MMM yyyy');
  return `${from} – ${formatInTimeZone(last, TZ, 'd MMM yyyy')}`;
}

export interface ReceiptEmailInput {
  receiptNo: string;
  planName: string;
  period: string;
  amountSen: number;
  billedTo: string;
  ssmNo: string | null;
  tin: string | null;
  accountUrl: string;
  websiteUrl: string;
}

/** M4 · Plan payment receipt, PDF attached (docs/wireframes/Email-Receipt.dc.html). */
export function receiptEmail(i: ReceiptEmailInput): RenderedEmail {
  const billed = [i.billedTo, i.ssmNo ? `SSM ${i.ssmNo}` : null, i.tin ? `TIN ${i.tin}` : null].filter(Boolean).join(' · ');
  return renderEmail({
    subject: `Receipt ${i.receiptNo} — OutletBooking`,
    preview: `We received ${rmText(i.amountSen)} for your ${i.planName} plan`,
    heading: 'Payment received',
    paragraphs: [
      [`Thank you. We received `, { bold: rmText(i.amountSen) }, ` for the `, { bold: `${i.planName} plan` }, ` (${i.period}).`],
      [`Receipt no. `, { bold: i.receiptNo }, `. The receipt is attached as a PDF.`],
      `Billed to: ${billed}`,
    ],
    button: { label: 'View billing & receipts', url: i.accountUrl },
    notes: ['Need to change the receipt details? Update them in billing; changes apply to new receipts only.'],
    footer: 'You got this receipt because a payment was made for your OutletBooking plan.',
    websiteUrl: i.websiteUrl,
  });
}

export interface RefundEmailInput {
  receiptNo: string;
  planName: string;
  refundSen: number;
  /** "Full refund" or "Part refund". */
  kind: 'full' | 'part';
  /** Malaysia day the refund was paid, "17 Oct 2026". */
  paidOn: string;
  planEnded: boolean;
  accountUrl: string;
  websiteUrl: string;
}

/** Refund note for a plan payment, naming the original receipt (docs/wireframes/Admin-PaymentDetail.dc.html). */
export function refundEmail(i: RefundEmailInput): RenderedEmail {
  return renderEmail({
    subject: `Refund for receipt ${i.receiptNo} — OutletBooking`,
    preview: `We refunded ${rmText(i.refundSen)} for your ${i.planName} plan`,
    heading: i.kind === 'full' ? 'Your payment was refunded' : 'Part of your payment was refunded',
    paragraphs: [
      [`We paid back `, { bold: rmText(i.refundSen) }, ` by bank transfer on ${i.paidOn} for the `, { bold: `${i.planName} plan` }, `.`],
      [`This refund is for receipt no. `, { bold: i.receiptNo }, `. It can take 1–3 working days to show in your bank account.`],
      i.planEnded
        ? 'Your plan has ended with this refund. You can choose a plan again any time from the app or billing page.'
        : 'Your plan stays active for the period you paid for.',
    ],
    button: { label: 'View billing & receipts', url: i.accountUrl },
    notes: ['Questions about this refund? Reply to this email or WhatsApp us.'],
    footer: 'You got this email because a refund was recorded for your OutletBooking plan payment.',
    websiteUrl: i.websiteUrl,
  });
}
