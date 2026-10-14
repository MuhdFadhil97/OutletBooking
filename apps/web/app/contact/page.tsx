import type { Metadata } from 'next';
import { ContactForm } from '@/components/ContactForm';
import { links } from '@/lib/config';
import { s } from '@/strings/en';

export const metadata: Metadata = { title: s.contact.metaTitle };

/** I19 · Contact: book a demo / question / account help → saved as a lead */
export default async function ContactPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const c = s.contact;
  return (
    <div className="wrap section" style={{ paddingTop: 40 }}>
      <h1 style={{ fontSize: 36 }}>{c.title}</h1>
      <p className="muted" style={{ margin: '8px 0 28px' }}>
        {c.intro}
      </p>
      <div className="grid contact-grid">
        <ContactForm initialReason={reason} />
        <aside className="card tile">
          <h3>{c.whatsappTitle}</h3>
          <p>{c.whatsappHours}</p>
          <a className="btn2" href={links.whatsapp(c.whatsappMessage)} target="_blank" rel="noopener noreferrer">
            {s.footer.whatsapp}
          </a>
          <div className="muted" style={{ marginTop: 12, fontSize: 14 }}>
            {c.companyDetails.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
