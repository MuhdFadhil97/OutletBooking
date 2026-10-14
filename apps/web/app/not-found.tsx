import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { links } from '@/lib/config';
import { s } from '@/strings/en';

export const metadata: Metadata = { title: s.notFound.metaTitle };

/** I20 · Website page not found (root level, so it has its own header and footer). */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main>
        <div className="wrap">
          <div className="not-found">
            <div className="code">404</div>
            <h1 style={{ fontSize: 32 }}>{s.notFound.title}</h1>
            <p className="muted">
              {s.notFound.text} <strong>{links.bookingLinkExample}</strong>.
            </p>
            <div className="actions">
              <Link className="btn" href="/">
                {s.notFound.home}
              </Link>
              <Link className="btn2" href="/contact">
                {s.notFound.contact}
              </Link>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
