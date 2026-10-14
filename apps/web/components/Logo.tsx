import Link from 'next/link';
import { s } from '@/strings/en';

/** Same mark as the app icon: calendar with a tick on green. */
export function Logo() {
  return (
    <Link href="/" className="logo" aria-label={`${s.brand} home`}>
      <span className="logo-mark" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M8 3v4M16 3v4M3 10h18M9 15l2 2 4-4" />
        </svg>
      </span>
      {s.brand}
    </Link>
  );
}
