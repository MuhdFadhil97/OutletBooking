import Link from 'next/link';
import { links } from '@/lib/config';
import { s } from '@/strings/en';
import { Logo } from './Logo';

const NAV = [
  { href: '/#businesses', label: s.nav.businesses },
  { href: '/#pricing', label: s.nav.pricing },
  { href: '/contact', label: s.nav.demo },
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
          <a className="nl" href={links.login}>
            {s.nav.login}
          </a>
          <a className="btn btn-sm" href={links.signup}>
            {s.nav.trial}
          </a>
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
            <a className="nl" href={links.login}>
              {s.nav.login}
            </a>
            <a className="btn" href={links.signup}>
              {s.nav.trial}
            </a>
          </div>
        </details>
      </div>
    </header>
  );
}
