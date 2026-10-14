import Link from 'next/link';
import { links } from '@/lib/config';
import { s } from '@/strings/en';

/** "Start free trial" (opens sign-up in the app); "Book a demo" in pre-launch mode. */
export function TrialButton({ label = s.cta.trial, className = 'btn' }: { label?: string; className?: string }) {
  if (links.signup) {
    return (
      <a className={className} href={links.signup}>
        {label}
      </a>
    );
  }
  return (
    <Link className={className} href={links.bookDemo}>
      {s.nav.demo}
    </Link>
  );
}
