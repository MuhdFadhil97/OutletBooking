import { SUPPORT_WHATSAPP } from './account';

/**
 * Privacy Notice (PDPA 2010) + Terms of Use. Shared so the app (`/privacy`, `/terms`), the
 * website (Phase 7) and the API (consent version) use the same text.
 *
 * DRAFT — have it reviewed by a Malaysian lawyer before launch; a Bahasa Malaysia version is
 * required by PDPA s.7(3) and comes with the BM translation work.
 *
 * Bump `LEGAL_VERSION` whenever the meaning changes; users store the version they agreed to.
 */
export const LEGAL_VERSION = '2026-10-11';
export const LEGAL_COMPANY = 'FTech IT Consulting Sdn Bhd';
export const LEGAL_PRODUCT = 'OutletBooking';

export interface LegalSection {
  heading: string;
  /** Paragraphs; lines starting with "• " render as bullets. */
  body: string[];
}

export interface LegalDoc {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}

const contact = `WhatsApp ${SUPPORT_WHATSAPP} (${LEGAL_COMPANY}).`;

export const PRIVACY_NOTICE: LegalDoc = {
  title: 'Privacy Notice (PDPA)',
  updated: LEGAL_VERSION,
  intro:
    `This notice explains how ${LEGAL_COMPANY} ("we"), the company behind ${LEGAL_PRODUCT}, handles personal data under the ` +
    'Personal Data Protection Act 2010 (PDPA). It covers business owners and staff who use the app, and customers who book through a business\'s booking page.',
  sections: [
    {
      heading: '1. Who is responsible',
      body: [
        `For owner and staff accounts, ${LEGAL_COMPANY} is the data user.`,
        `For customers who book with a business, that business is the data user. ${LEGAL_PRODUCT} stores and processes the booking on the business's behalf and only on its instructions. Questions about a booking should go to the business first.`,
      ],
    },
    {
      heading: '2. What we collect',
      body: [
        '• Owners and staff: name, email, mobile number, password (stored hashed), business details, the device push token, and what you do in the app (bookings created, payments recorded).',
        '• Customers: name, mobile number, optionally email and address (for at-your-place services), answers to the business\'s booking questions, notes, and booking and payment history.',
        '• Job photos that staff add to a booking.',
        '• Technical data: IP address and browser / device type, used for security and to stop abuse.',
        'We only ask for what the booking needs. We do not collect card or bank login details — online payments happen on ToyyibPay\'s page.',
      ],
    },
    {
      heading: '3. Why we use it',
      body: [
        '• To create and manage bookings, reminders and confirmations.',
        '• To take payments through the business\'s own ToyyibPay account and record refunds.',
        '• To send notifications to the business and its staff.',
        '• To show the business its reports.',
        '• To run your account: log in, password reset, trial and plan billing, support.',
        '• To keep the service secure and meet legal obligations.',
        'We do not sell personal data and we do not use customer data for our own marketing.',
      ],
    },
    {
      heading: '4. Who we share it with',
      body: [
        'Only with service providers that help us run the service, under contract:',
        '• ToyyibPay (payments), Expo (push notifications), our email provider (password emails), and our hosting, database and file-storage providers.',
        'Some of these keep data outside Malaysia (for example in Singapore). We only use providers with security and privacy protection comparable to the PDPA.',
        'We may also disclose data where the law requires it.',
      ],
    },
    {
      heading: '5. How long we keep it',
      body: [
        'Booking and payment records are kept while the business uses the service, for its reports and accounts.',
        'When a business deletes its account, its data and files are permanently deleted.',
        'When a customer asks the business to delete their data, the business can anonymise them: name, phone, email, address, notes and booking answers are removed; the booking and payment amounts stay for the business\'s records.',
      ],
    },
    {
      heading: '6. Your rights',
      body: [
        'You can ask to access or correct your personal data, withdraw consent, or ask us to stop using it.',
        '• Customers: contact the business you booked with — they can update or erase your details in the app. You can also contact us and we will pass the request on.',
        '• Owners and staff: change your details in the app, delete your account from "My account", or contact us.',
        'If you withdraw consent we may not be able to keep providing the service.',
      ],
    },
    {
      heading: '7. Security',
      body: [
        'Data is sent over HTTPS. Passwords are hashed. Each business\'s ToyyibPay secret key is encrypted, and each business can only see its own data. Job photos are private and shown through short-lived links.',
      ],
    },
    {
      heading: '8. Contact',
      body: [`Questions or requests about personal data: ${contact}`, 'We may update this notice. The date above shows the latest version; we will ask you to agree again if the change matters.'],
    },
  ],
};

export const TERMS: LegalDoc = {
  title: 'Terms of Use',
  updated: LEGAL_VERSION,
  intro:
    `These terms apply when a business signs up for ${LEGAL_PRODUCT}, provided by ${LEGAL_COMPANY} ("we"). ` +
    'By creating an account or accepting a staff invitation you agree to them.',
  sections: [
    {
      heading: '1. The service',
      body: [
        `${LEGAL_PRODUCT} lets a business take bookings through a web booking page, manage its calendar, staff and payments, and see reports.`,
        'We aim to keep the service available but do not promise it will never be interrupted.',
      ],
    },
    {
      heading: '2. Trial and plans',
      body: [
        'New businesses get a free 7-day trial. After it ends you need a paid plan to keep making changes and taking bookings; your data stays readable.',
        'Plan prices are shown in the app and on our website. Plan fees are paid to us and are not refundable unless the law says otherwise.',
      ],
    },
    {
      heading: '3. Customer payments',
      body: [
        'Customer payments go to the business\'s OWN ToyyibPay account. We never hold customer money.',
        'The business is responsible for its prices, deposits, cancellations, refunds and any fees charged by ToyyibPay.',
      ],
    },
    {
      heading: '4. Your responsibilities',
      body: [
        '• Keep your login details safe and give staff only the access they need.',
        '• Give accurate information and keep your services, prices and opening hours up to date.',
        '• As the data user for your customers, handle their data in line with the PDPA and our Privacy Notice, and act on their access or deletion requests.',
        '• Do not use the service for anything unlawful, to send spam, or to attack or overload it.',
      ],
    },
    {
      heading: '5. Your data',
      body: [
        'Your business data belongs to you. We use it only to provide the service, as described in the Privacy Notice.',
        'You can delete your account and business data at any time from "My account". Deletion is permanent.',
      ],
    },
    {
      heading: '6. Suspension',
      body: [
        'We may pause a booking page or account that breaks these terms, puts others at risk, or has no active plan. Where we can, we will tell you first.',
      ],
    },
    {
      heading: '7. Liability',
      body: [
        'The service is provided "as is". To the extent the law allows, we are not liable for indirect losses such as lost bookings or profit, and our total liability is limited to the plan fees you paid us in the 12 months before the claim.',
      ],
    },
    {
      heading: '8. Changes and law',
      body: [
        'We may update these terms; we will ask you to agree again if the change matters. These terms are governed by the laws of Malaysia.',
        `Contact: ${contact}`,
      ],
    },
  ],
};
