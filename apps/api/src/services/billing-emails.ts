import { formatInTimeZone } from 'date-fns-tz';
import { WEB_SIGN_IN_LINK_MINUTES } from '@outletbooking/shared';
import { renderEmail, type EmailParagraph, type RenderedEmail } from './email-template';

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

export interface TrialEndingEmailInput {
  businessName: string;
  /** The trial has already ended (the page is paused) — day 7; otherwise day 5. */
  ended: boolean;
  /** Malaysia day the trial ends, "17 Oct". */
  endsOn: string;
  /** What the business did during the trial; null when nothing happened yet. */
  stats: { days: number; bookings: number; paidSen: number; newCustomers: number } | null;
  planUrl: string;
  websiteUrl: string;
}

/** M5 · Trial ending / ended (docs/wireframes/Email-TrialEnding.dc.html). */
export function trialEndingEmail(i: TrialEndingEmailInput): RenderedEmail {
  const paragraphs: EmailParagraph[] = [];
  if (i.stats && i.stats.bookings > 0) {
    paragraphs.push([
      `Here’s what `,
      { bold: i.businessName },
      ` did in the last ${i.stats.days} day${i.stats.days === 1 ? '' : 's'}: `,
      { bold: `${i.stats.bookings} booking${i.stats.bookings === 1 ? '' : 's'}` },
      i.stats.paidSen > 0 ? [`, `, { bold: `${rmText(i.stats.paidSen)} paid online` }] : '',
      i.stats.newCustomers > 0 ? `, ${i.stats.newCustomers} new customer${i.stats.newCustomers === 1 ? '' : 's'}` : '',
      `.`,
    ].flat());
  }
  paragraphs.push(
    i.ended
      ? `Your free trial ended on ${i.endsOn}, so your booking page is paused. Your bookings and customers are kept — choose a plan any time to switch it back on.`
      : `Choose a plan to keep your booking page open. If you don’t, the page pauses on ${i.endsOn} — your bookings and customers are kept, and you can pay any time to switch it back on.`,
  );
  return renderEmail({
    subject: i.ended ? 'Your free trial has ended' : `Your free trial ends ${i.endsOn}`,
    preview: i.ended ? 'Choose a plan to turn your booking page back on' : 'Choose a plan to keep your booking page live',
    heading: i.ended ? 'Your free trial has ended' : `Your free trial ends ${i.endsOn}`,
    paragraphs,
    button: { label: 'Choose a plan', url: i.planUrl },
    notes: ['Need more time or help? Reply to this email or WhatsApp us.'],
    footer: 'Sent on day 5 and day 7 of your free trial.',
    websiteUrl: i.websiteUrl,
  });
}

export interface RenewalEmailInput {
  businessName: string;
  planName: string;
  /** `due`: reminder before the end · `grace`: ended, page still live · `ended`: grace over, page paused. */
  stage: 'due' | 'grace' | 'ended';
  /** 0 = today, 1 = tomorrow, n = in n days (only for `due`). */
  daysLeft: number;
  /** Malaysia day the paid period ends, "17 Nov 2026". */
  endsOn: string;
  /** Malaysia day the grace period ends; null when there is no grace. */
  graceUntil: string | null;
  payUrl: string;
  websiteUrl: string;
}

const whenText = (days: number) => (days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);

/** Renewal reminder, "plan ended — page still live" and "page paused" (manual renewal, FR-20.7 grace and reminder days). */
export function renewalEmail(i: RenewalEmailInput): RenderedEmail {
  const keep = `Your bookings and customers are kept either way.`;
  const copy =
    i.stage === 'due'
      ? {
          subject: `Your ${i.planName} plan ends ${whenText(i.daysLeft)}`,
          preview: 'Pay for the next month to keep your booking page open',
          heading: `Your plan ends ${whenText(i.daysLeft)}`,
          paragraphs: [
            [`Your `, { bold: `${i.planName} plan` }, ` for `, { bold: i.businessName }, ` ends on ${i.endsOn}.`],
            `Pay for the next month before then so your booking page doesn’t stop. ${
              i.graceUntil ? `If you miss it, the page stays live until ${i.graceUntil} and then pauses. ` : 'If you miss it, the page pauses. '
            }${keep}`,
          ],
          button: 'Pay for next month',
          footer: 'You got this because your OutletBooking plan is about to end.',
        }
      : i.stage === 'grace'
        ? {
            subject: `Your ${i.planName} plan has ended`,
            preview: `Your booking page stays live until ${i.graceUntil}`,
            heading: 'Your plan has ended',
            paragraphs: [
              [`Your `, { bold: `${i.planName} plan` }, ` for `, { bold: i.businessName }, ` ended on ${i.endsOn}.`],
              `Your booking page stays live until ${i.graceUntil}. Pay for a month before then so customers can keep booking. ${keep}`,
            ],
            button: 'Pay now',
            footer: 'You got this because your OutletBooking plan was not renewed.',
          }
        : {
            subject: 'Your booking page is paused',
            preview: 'Pay for a month to switch it back on',
            heading: 'Your booking page is paused',
            paragraphs: [
              [`Your `, { bold: `${i.planName} plan` }, ` for `, { bold: i.businessName }, ` ended on ${i.endsOn} and the extra days are over, so customers can’t book right now.`],
              `Pay for a month to switch it back on straight away. ${keep}`,
            ],
            button: 'Pay now',
            footer: 'You got this because your OutletBooking plan was not renewed.',
          };
  return renderEmail({
    subject: copy.subject,
    preview: copy.preview,
    heading: copy.heading,
    paragraphs: copy.paragraphs,
    button: { label: copy.button, url: i.payUrl },
    notes: ['Need help or more time? Reply to this email or WhatsApp us.'],
    footer: copy.footer,
    websiteUrl: i.websiteUrl,
  });
}

export interface DeletionNoticeEmailInput {
  businessName: string;
  /** "Fri, 13 Nov 2026" in Malaysia time. */
  deleteOn: string;
  /** Where to choose a plan (the website sign-in page). */
  keepUrl: string;
  websiteUrl: string;
}

/** M7 · Sent 30 days before data is deleted (docs/wireframes/Email-DeletionNotice.dc.html). */
export function deletionNoticeEmail(i: DeletionNoticeEmailInput): RenderedEmail {
  return renderEmail({
    subject: `Your OutletBooking data will be deleted on ${i.deleteOn}`,
    preview: 'Choose a plan or ask for a copy before then',
    heading: `Your data will be deleted on ${i.deleteOn}`,
    paragraphs: [
      [{ bold: i.businessName }, ` hasn’t had an active plan for 12 months. As our Terms say, we’ll delete the business’s bookings, customers, staff accounts and settings on `, { bold: i.deleteOn }, `.`],
      'Want to keep it? Choose a plan before then and everything switches back on.',
    ],
    button: { label: 'Keep my account', url: i.keepUrl },
    notes: ['Need a copy first? Contact us and we’ll send an export to this email. Receipts for plans you paid are kept for 7 years for tax.'],
    footer: 'Sent 30 days before data deletion, as described in the Terms and Privacy notice.',
    websiteUrl: i.websiteUrl,
  });
}

export interface StaffInviteEmailInput {
  businessName: string;
  /** The owner who invited them. */
  inviterName: string;
  /** What they will be able to do, as a sentence start: "see your bookings, check customers in and record payments". */
  abilities: string;
  /** The resource they are linked to ("Court 1"), if any. */
  linkedTo: string | null;
  acceptUrl: string;
  /** "7 days" */
  expiresIn: string;
  websiteUrl: string;
}

/** M3 · Staff invite (docs/wireframes/Email-StaffInvite.dc.html). */
export function staffInviteEmail(i: StaffInviteEmailInput): RenderedEmail {
  return renderEmail({
    subject: `${i.businessName} invited you to OutletBooking`,
    preview: 'Accept to see your schedule on your phone',
    heading: `You\u2019re invited to join ${i.businessName}`,
    paragraphs: [
      [{ bold: i.inviterName }, ` added you as `, { bold: 'Staff' }, `. You\u2019ll ${i.abilities}.`],
      [`Business: `, { bold: i.businessName }, i.linkedTo ? ` \u00b7 Linked to: ${i.linkedTo}` : ''].flat(),
    ],
    button: { label: 'Accept invite', url: i.acceptUrl },
    notes: [`The invite expires in ${i.expiresIn}. After accepting, download the OutletBooking app and log in with this email.`],
    footer: `You got this email because the owner of ${i.businessName} entered your address. Not expecting it? Ignore it.`,
    websiteUrl: i.websiteUrl,
  });
}

/** "see your bookings, check customers in and record payments": what the staff member's permissions allow. */
export function staffAbilities(p: { canViewAll: boolean; canTakePayments: boolean; canEditSetup: boolean }): string {
  const list = [p.canViewAll ? 'see all bookings' : 'see your bookings', 'check customers in'];
  if (p.canTakePayments) list.push('record payments');
  if (p.canEditSetup) list.push('edit services, prices and hours');
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

export interface DataExportEmailInput {
  businessName: string;
  ownerName: string;
  files: { name: string; rows: number }[];
  appUrl: string;
  websiteUrl: string;
}

/** The copy of a business's data an owner asked FTech for (PDPA access / before closing). The files are attached. */
export function dataExportEmail(i: DataExportEmailInput): RenderedEmail {
  return renderEmail({
    subject: `Your OutletBooking data export \u2014 ${i.businessName}`,
    preview: 'A copy of your data, attached as spreadsheet files',
    heading: 'Your data export',
    paragraphs: [
      `Hi ${i.ownerName}, as requested, here is a copy of ${i.businessName}\u2019s data from OutletBooking, attached as spreadsheet (CSV) files that open in Excel or Google Sheets.`,
      i.files.map((f) => `${f.name} \u00b7 ${f.rows} row${f.rows === 1 ? '' : 's'}`).join('  |  '),
      'It contains your customers\u2019 names and phone numbers. Please keep it safe and do not forward it.',
    ],
    button: { label: 'Open OutletBooking', url: i.appUrl },
    notes: ['Didn\u2019t ask for this? Reply to this email and tell us.'],
    footer: 'You got this because FTech was asked to export the data of your OutletBooking business.',
    websiteUrl: i.websiteUrl,
  });
}
