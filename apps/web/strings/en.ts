import type { BusinessTemplate, LeadReason } from '@outletbooking/shared';

/** Website copy (I3, I18–I23). Kept in one place for the Bahasa Malaysia version later. */

export interface FaqItem {
  q: string;
  a: string;
}

/** I21–I23: one page, copy per business type. Facts (services, questions) come from TEMPLATE_INFO. */
export interface TypePageCopy {
  title: string;
  headline: string;
  intro: string;
  preview: { business: string; subtitle: string; rows: [string, string][]; button: string };
  features: { title: string; text: string }[];
  steps: [string, string][];
  faq: FaqItem[];
}

export const TYPE_PAGE_SLUGS = {
  sports: 'sports',
  'real-estate': 'real_estate',
  'vehicle-inspection': 'vehicle_inspection',
} as const satisfies Record<string, BusinessTemplate>;
export type TypePageSlug = keyof typeof TYPE_PAGE_SLUGS;

export const s = {
  brand: 'OutletBooking',
  company: 'FTech IT Consulting Sdn Bhd',
  nav: {
    businesses: 'Businesses',
    pricing: 'Pricing',
    demo: 'Book a demo',
    login: 'Log in',
    trial: 'Start free trial',
    menu: 'Menu',
  },
  footer: {
    privacy: 'Privacy notice (PDPA)',
    terms: 'Terms',
    refund: 'Refund policy',
    contact: 'Contact',
    whatsapp: 'WhatsApp us',
    copyright: (year: number) => `© ${year} FTech IT Consulting Sdn Bhd · OutletBooking`,
  },
  cta: {
    trial: 'Start 7-day free trial',
    seeBookingPage: 'See a booking page',
    seeSample: 'See a sample booking page',
    demo: 'Or book a 20-minute demo',
    learnMore: 'Learn more →',
  },

  home: {
    metaTitle: 'OutletBooking — online booking and payment for Malaysian businesses',
    metaDescription:
      'One link for courts, viewings, inspections or appointments. Customers pick a time and pay a deposit by FPX or DuitNow. 7-day free trial.',
    badge: 'Made in Malaysia · FPX & DuitNow',
    headline: 'Let customers book and pay — without the WhatsApp back-and-forth',
    intro:
      'One link for courts, viewings, inspections or appointments. Customers pick a time and pay a deposit. You see everything on your phone.',
    noCard: 'No card needed · set up in about 10 minutes',
    preview: {
      business: 'Smash Arena PJ',
      subtitle: 'Book a court',
      rows: [
        ['Court 1 · 8–10 PM', 'Free'],
        ['Court 2 · 8–10 PM', 'Free'],
      ] as [string, string][],
      button: 'Pay RM 60 · FPX',
    },
    typesTitle: 'Built for businesses that run on appointments',
    types: [
      { title: 'Sports courts', text: 'Court-by-hour grid, peak pricing, full prepayment.', slug: 'sports' },
      { title: 'Real estate viewings', text: 'Book by agent, travel time between viewings, listings.', slug: 'real-estate' },
      {
        title: 'Vehicle inspection',
        text: 'Plate number on every booking, mobile inspection, WhatsApp report.',
        slug: 'vehicle-inspection',
      },
      { title: 'Workshops', text: 'Bays, jobs with “from” prices, quotes before work.' },
      { title: 'Barbers & salons', text: 'Customers pick a stylist, walk-in queue.' },
      { title: 'Clinics, tuition & more', text: 'Rename what is booked — rooms, doctors, teachers.' },
    ] as { title: string; text: string; slug?: TypePageSlug }[],
    stepsTitle: 'Live in three steps',
    steps: [
      ['Pick your business type', 'Services, hours and booking questions are filled in for you.'],
      ['Connect ToyyibPay', 'Deposits and payments go straight to your own account.'],
      ['Share your link', 'Put it in WhatsApp Business, Instagram and on a QR poster at the counter.'],
    ] as [string, string][],
    faqTitle: 'Questions',
    faq: [
      { q: 'Do my customers need to download an app?', a: 'No. They book from a link or QR code in their phone browser.' },
      { q: 'Who receives the money?', a: 'You do. Payments go to your own ToyyibPay account and then your bank.' },
      { q: 'Can two people book the same slot?', a: 'No. The system blocks double bookings automatically.' },
      {
        q: 'What happens after the free trial?',
        a: 'Choose a plan to keep your booking page live. Your data is kept either way.',
      },
    ] as FaqItem[],
  },

  pricing: {
    title: 'Simple pricing',
    perMonth: '/ month',
    plans: {
      starter: { name: 'Starter', features: ['Unlimited bookings', 'Online payment & deposits'] },
      business: { name: 'Business', features: ['Staff app & roles', 'Reports & customer history'] },
    },
    upTo: (n: number) => `Up to ${n} bookable resources`,
    extra: (rm: string) => `Extra resource ${rm} / month. More than 10?`,
    talk: 'Talk to us',
    afterTrial: (starter: string, business: string) => `Starter ${starter} · Business ${business} per month after the trial`,
  },

  typePage: {
    back: '← All business types',
    featuresTitle: 'What you get',
    readyTitle: 'Ready on day one',
    readyIntro: 'These are filled in when you sign up. Change names, prices and times any time.',
    servicesLabel: 'Services',
    questionsLabel: 'Booking questions',
    free: 'Free',
    deposit: (rm: string) => `${rm} deposit`,
    payInFull: 'pay in full',
    minutes: (n: number) => `${n} min`,
    stepsTitle: 'Set up in about 10 minutes',
    faqTitle: 'Questions',
    trialTitle: 'Try it free for 7 days',
    pages: {
      sports: {
        title: 'Sports courts',
        headline: 'Fill your courts without answering WhatsApp all day',
        intro:
          'Players see free courts by the hour, pick 1–3 hours and pay in full by FPX or DuitNow. No double bookings, no no-shows from unpaid “holds”.',
        preview: {
          business: 'Smash Arena PJ',
          subtitle: 'Badminton · Sat, 10 Oct',
          rows: [
            ['Court 1 · 8–10 PM', 'Free'],
            ['Court 2 · 8–10 PM', 'Free'],
            ['Court 3 · 8–9 PM', 'Free'],
            ['Peak price after 6 PM', 'RM 30/hr'],
          ],
          button: 'Pay RM 60 · FPX',
        },
        features: [
          { title: 'Court × time grid', text: 'Customers see every court’s free hours on one screen.' },
          { title: 'Peak & off-peak prices', text: 'Higher price for evenings and weekends, set once.' },
          { title: 'Pay before it’s booked', text: 'Unpaid bookings are released after a few minutes.' },
          { title: 'Walk-ins too', text: 'Add a walk-in from the counter in two taps.' },
        ],
        steps: [
          ['Add your courts and sports', 'Badminton, futsal, pickleball…'],
          ['Set hours and peak prices', 'Weekday and weekend rules'],
          ['Connect your ToyyibPay', 'Money goes straight to you'],
          ['Share your link and QR poster', 'WhatsApp, Instagram, counter'],
        ],
        faq: [
          { q: 'Can a player book 2 hours in a row?', a: 'Yes. You choose which lengths to offer — 1, 2 or 3 hours.' },
          {
            q: 'What if someone books but doesn’t pay?',
            a: 'The court is held for a few minutes, then released automatically.',
          },
          { q: 'Do players need an app?', a: 'No. They book in their phone browser.' },
        ],
      },
      real_estate: {
        title: 'Real estate',
        headline: 'Let buyers and tenants book viewings with the right agent',
        intro:
          'Viewers pick a listing, an agent and a time. Travel time between viewings is blocked automatically, and agents see their day with directions.',
        preview: {
          business: 'Laman Realty',
          subtitle: 'Book a viewing',
          rows: [
            ['Agent Aina', 'Mont Kiara'],
            ['Thu, 15 Oct', '11:00 AM'],
            ['Condo', 'Rent'],
            ['Buyer or tenant', 'Tenant'],
          ],
          button: 'Request viewing',
        },
        features: [
          { title: 'Book by agent', text: 'Each agent has their own hours and areas.' },
          { title: 'Travel time blocked', text: '30 minutes between viewings by default, with Waze links.' },
          { title: 'Pick a listing', text: 'Viewers choose which property to see.' },
          { title: 'WhatsApp details', text: 'Agent contact sent right after booking.' },
        ],
        steps: [
          ['Add your agents', 'Hours and areas for each'],
          ['Add viewing types', 'Sale, rent, project launch'],
          ['Set travel time', 'Between viewings'],
          ['Share your link', 'In listings and WhatsApp'],
        ],
        faq: [
          { q: 'Do viewers pay anything?', a: 'Not by default. You can ask for a deposit if you want.' },
          { q: 'Can I show my listings?', a: 'Yes — add your listings and viewers pick the property they want to see.' },
          { q: 'Can agents use their phones?', a: 'Yes. Agents get the staff app with their own viewings.' },
        ],
      },
      vehicle_inspection: {
        title: 'Vehicle inspection',
        headline: 'Inspection bookings with the plate number and deposit upfront',
        intro:
          'Customers choose an inspection, give their plate number and car details, and pay a deposit. Offer mobile inspection at their location too.',
        preview: {
          business: 'SemakAuto Puchong',
          subtitle: 'Pre-purchase inspection',
          rows: [
            ['Plate number', 'WXY 1234'],
            ['Honda City · 2019', '60 min'],
            ['Tue, 13 Oct', '10:00 AM'],
            ['Deposit', 'RM 50'],
          ],
          button: 'Pay deposit RM 50',
        },
        features: [
          { title: 'Your own questions', text: 'Plate number, make & model, year — searchable later.' },
          { title: 'Mobile inspection', text: 'Travel fee and service area for on-site jobs.' },
          { title: 'Deposit upfront', text: 'Collect the balance after the job.' },
          { title: 'Checklist & report', text: 'Fill in the checklist and send the result on WhatsApp.' },
        ],
        steps: [
          ['Add bays and inspectors', 'Who does what'],
          ['Add inspection types', 'Prices and deposits'],
          ['Choose booking questions', 'Plate number is ready'],
          ['Share your link', 'Google Maps, WhatsApp, Facebook'],
        ],
        faq: [
          { q: 'Can I search by plate number?', a: 'Yes. Plate number is searchable in your bookings.' },
          {
            q: 'Can customers book an inspector at their home?',
            a: 'Yes — turn on mobile inspection and set your area and fee.',
          },
          {
            q: 'How do customers pay the balance?',
            a: 'Cash, DuitNow QR or card at the end — staff record it in the app.',
          },
        ],
      },
    } satisfies Record<(typeof TYPE_PAGE_SLUGS)[TypePageSlug], TypePageCopy>,
  },

  legal: {
    metaTitle: 'Privacy, terms & refunds — OutletBooking',
    tabs: { privacy: 'Privacy notice', terms: 'Terms of service', refund: 'Refund policy' },
    langs: { en: 'English', ms: 'Bahasa Melayu' },
    draft: 'Draft — these texts are being reviewed by a lawyer before launch.',
  },

  contact: {
    metaTitle: 'Contact — OutletBooking',
    title: 'Talk to us',
    intro: 'We reply within one working day, usually on WhatsApp.',
    need: 'What do you need?',
    reasons: { demo: 'Book a demo', question: 'A question', account_help: 'Help with my account' } satisfies Record<
      LeadReason,
      string
    >,
    name: 'Your name',
    businessName: 'Business name',
    phone: 'Mobile (WhatsApp)',
    phonePlaceholder: '012 345 6789',
    email: 'Email',
    businessType: 'Type of business',
    businessTypeChoose: 'Choose…',
    businessTypes: {
      sports: 'Sports courts',
      real_estate: 'Real estate',
      vehicle_inspection: 'Vehicle inspection',
      workshop: 'Workshop',
      barber_salon: 'Barber / salon',
      clinic: 'Clinic',
      tuition: 'Tuition',
      other: 'Other',
    } satisfies Record<BusinessTemplate, string>,
    resourceCount: 'How many courts / staff / bays?',
    message: 'Anything else? (optional)',
    consent: 'I agree that FTech may contact me about this request, as in the',
    consentLink: 'privacy notice',
    send: 'Send',
    sending: 'Sending…',
    sent: 'Thanks — we got your message. We’ll reply within one working day.',
    sendAnother: 'Send another message',
    error: 'Could not send. Check your connection and try again, or WhatsApp us.',
    tooMany: 'Too many messages from this connection. Please WhatsApp us instead.',
    phoneOrEmail: 'Give a mobile number or an email so we can reply.',
    whatsappTitle: 'Prefer WhatsApp?',
    whatsappHours: 'Mon – Fri, 9 AM – 6 PM',
    whatsappMessage: 'Hi OutletBooking, I have a question.',
    companyDetails: ['FTech IT Consulting Sdn Bhd [SSM no.]', '[Office address]', '[hello@outletbooking.my]'],
  },

  notFound: {
    metaTitle: 'Page not found — OutletBooking',
    title: 'Page not found',
    text: 'The link may be old or mistyped. Looking for a business’s booking page? Ask them for their link — it looks like',
    home: 'Go to home page',
    contact: 'Contact us',
  },
};
