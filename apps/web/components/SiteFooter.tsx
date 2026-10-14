import Link from 'next/link';
import { links } from '@/lib/config';
import { s } from '@/strings/en';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <span className="muted">{s.footer.copyright(new Date().getFullYear())}</span>
        <nav aria-label="Footer">
          <Link href="/privacy">{s.footer.privacy}</Link>
          <Link href="/terms">{s.footer.terms}</Link>
          <Link href="/refund">{s.footer.refund}</Link>
          <Link href="/contact">{s.footer.contact}</Link>
          <a href={links.whatsapp(s.contact.whatsappMessage)} target="_blank" rel="noopener noreferrer">
            {s.footer.whatsapp}
          </a>
        </nav>
      </div>
    </footer>
  );
}
