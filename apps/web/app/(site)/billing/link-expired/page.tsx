import type { Metadata } from 'next';
import Link from 'next/link';
import { links } from '@/lib/config';
import { s } from '@/strings/en';

export const metadata: Metadata = { title: s.billing.expired.metaTitle, robots: { index: false, follow: false } };

/** I14 · The sign-in link expired or was already used */
export default function BillingLinkExpiredPage() {
  const e = s.billing.expired;
  return (
    <div className="wrap billing-wrap billing-narrow">
      <div className="card billing-card">
        <h1>{e.title}</h1>
        <p className="muted">{e.text}</p>
        <div className="actions">
          <Link className="btn" href="/billing/sign-in">
            {e.newLink}
          </Link>
          {links.login && (
            <a className="btn2" href={links.login}>
              {e.openApp}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
