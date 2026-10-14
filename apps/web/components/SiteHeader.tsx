import Link from 'next/link';
import { appLive, links } from '@/lib/config';
import { s } from '@/strings/en';
import { Logo } from './Logo';
import { TrialButton } from './TrialButton';

const NAV = [
  { href: '/#businesses', label: s.nav.businesses },
  { href: '/#pricing', label: s.nav.pricing },
  // Pre-launch: the main button is already "Book a demo".
  ...(appLive ? [{ href: links.bookDemo, label: s.nav.demo }] : []),
];

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="wrap">
        <Logo />
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} className="nl" href={n.href}>
              {n.label}
            </Link>
          ))}
          {links.login && (
            <a className="nl" href={links.login}>
              {s.nav.login}
            </a>
          )}
          <TrialButton label={s.nav.trial} className="btn btn-sm" />
        </nav>
        {/* Small screens: no-JS disclosure menu */}
        <details className="menu">
          <summary className="btn2 btn-sm">{s.nav.menu}</summary>
          <div className="menu-panel">
            {NAV.map((n) => (
              <Link key={n.href} className="nl" href={n.href}>
                {n.label}
              </Link>
            ))}
            {links.login && (
              <a className="nl" href={links.login}>
                {s.nav.login}
              </a>
            )}
            <TrialButton label={s.nav.trial} />
          </div>
        </details>
      </div>
    </header>
  );
}
