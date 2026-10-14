import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';
import { s } from '@/strings/en';

export const metadata: Metadata = {
  title: s.admin.metaTitle,
  robots: { index: false, follow: false },
};

/** FTech platform admin (desktop): no website header or footer. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin">
      <header className="admin-top">
        <Logo />
        <span className="muted small">{s.admin.tagline}</span>
      </header>
      <main>{children}</main>
    </div>
  );
}
