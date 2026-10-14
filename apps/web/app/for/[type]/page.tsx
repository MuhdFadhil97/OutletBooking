import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TEMPLATE_INFO, type TemplateService } from '@outletbooking/shared';
import { BookingPreview } from '@/components/BookingPreview';
import { Faq } from '@/components/Faq';
import { afterTrialLine } from '@/components/Pricing';
import { TrialButton } from '@/components/TrialButton';
import { links } from '@/lib/config';
import { formatRm } from '@/lib/money';
import { s, TYPE_PAGE_SLUGS, type TypePageSlug } from '@/strings/en';

/**
 * I21–I23 · Business-type pages. One page for every type: copy from strings, and the
 * ready-made services and booking questions from the same template config as sign-up step 3.
 */

type Props = { params: Promise<{ type: string }> };

const isTypeSlug = (v: string): v is TypePageSlug => Object.hasOwn(TYPE_PAGE_SLUGS, v);

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(TYPE_PAGE_SLUGS).map((type) => ({ type }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type } = await params;
  if (!isTypeSlug(type)) return {};
  const copy = s.typePage.pages[TYPE_PAGE_SLUGS[type]];
  return { title: `OutletBooking for ${copy.title}`, description: copy.intro };
}

function servicePrice(svc: TemplateService): string {
  const t = s.typePage;
  if (svc.priceSen === 0) return t.free;
  const price = formatRm(svc.priceSen);
  if (svc.depositSen) return `${price} · ${t.deposit(formatRm(svc.depositSen))}`;
  return svc.prepayFull ? `${price} · ${t.payInFull}` : price;
}

export default async function TypePage({ params }: Props) {
  const { type } = await params;
  if (!isTypeSlug(type)) notFound();
  const template = TYPE_PAGE_SLUGS[type];
  const copy = s.typePage.pages[template];
  const info = TEMPLATE_INFO[template];
  const t = s.typePage;

  return (
    <>
      <div className="wrap hero">
        <div>
          <Link href="/#businesses" className="muted" style={{ fontWeight: 600, textDecoration: 'none' }}>
            {t.back}
          </Link>
          <p className="tag" style={{ marginTop: 16 }}>
            {copy.title}
          </p>
          <h1>{copy.headline}</h1>
          <p className="lead">{copy.intro}</p>
          <div className="actions">
            <TrialButton />
            {links.demoBookingPage && (
              <a className="btn2" href={links.demoBookingPage} target="_blank" rel="noopener noreferrer">
                {s.cta.seeSample}
              </a>
            )}
          </div>
          {links.signup && (
            <p className="note">
              <Link href={links.bookDemo}>{s.cta.demo}</Link>
            </p>
          )}
        </div>
        <BookingPreview {...copy.preview} />
      </div>

      <section className="section band">
        <div className="wrap">
          <h2 className="section-title">{t.featuresTitle}</h2>
          <div className="grid grid-4">
            {copy.features.map((f) => (
              <div key={f.title} className="card tile">
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>{t.readyTitle}</h2>
          <p className="muted" style={{ margin: '8px 0 24px' }}>
            {t.readyIntro}
          </p>
          <div className="grid grid-2">
            <div className="card facts">
              <h3>{t.servicesLabel}</h3>
              <ul>
                {info.services.map((svc) => (
                  <li key={svc.name}>
                    <span>
                      {svc.name} · {t.minutes(svc.durationMin)}
                    </span>
                    <span>{servicePrice(svc)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card facts">
              <h3>{t.questionsLabel}</h3>
              <ul>
                {info.bookingFields.map((f) => (
                  <li key={f.fieldKey}>
                    <span>{f.label}</span>
                    <span>{f.options?.join(' / ') ?? ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section band">
        <div className="wrap">
          <h2 className="section-title">{t.stepsTitle}</h2>
          <ol className="grid grid-4" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {copy.steps.map(([title, text], i) => (
              <li key={title} className="card tile">
                <span className="step-num">{i + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <Faq title={t.faqTitle} items={copy.faq} />

      <section className="band trial-band">
        <div className="wrap">
          <h2>{t.trialTitle}</h2>
          <p className="muted">{afterTrialLine()}</p>
          <TrialButton label={s.nav.trial} />
        </div>
      </section>
    </>
  );
}
