import Link from 'next/link';
import { BookingPreview } from '@/components/BookingPreview';
import { Faq } from '@/components/Faq';
import { Pricing } from '@/components/Pricing';
import { links } from '@/lib/config';
import { s } from '@/strings/en';

/** I3 · Website landing page */
export default function HomePage() {
  const h = s.home;
  return (
    <>
      <div className="wrap hero">
        <div>
          <span className="tag">{h.badge}</span>
          <h1>{h.headline}</h1>
          <p className="lead">{h.intro}</p>
          <div className="actions">
            <a className="btn" href={links.signup}>
              {s.cta.trial}
            </a>
            <a className="btn2" href={links.demoBookingPage} target="_blank" rel="noopener noreferrer">
              {s.cta.seeBookingPage}
            </a>
          </div>
          <p className="note muted">{h.noCard}</p>
        </div>
        <BookingPreview {...h.preview} />
      </div>

      <section id="businesses" className="section band">
        <div className="wrap">
          <h2 className="section-title">{h.typesTitle}</h2>
          <div className="grid grid-3">
            {h.types.map((t) => (
              <div key={t.title} className="card tile">
                <h3>{t.title}</h3>
                <p>{t.text}</p>
                {t.slug && (
                  <Link className="more" href={`/for/${t.slug}`}>
                    {s.cta.learnMore}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="section-title">{h.stepsTitle}</h2>
          <ol className="grid grid-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {h.steps.map(([title, text], i) => (
              <li key={title} className="card tile">
                <span className="step-num">{i + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <div className="band">
        <Pricing />
      </div>

      <Faq title={h.faqTitle} items={h.faq} />
    </>
  );
}
