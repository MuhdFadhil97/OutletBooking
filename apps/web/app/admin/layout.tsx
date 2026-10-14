import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { s } from '@/strings/en';

export const metadata: Metadata = {
  title: s.admin.metaTitle,
  robots: { index: false, follow: false },
};

/** FTech platform admin (desktop): no website header or footer. Sign-in pages vs. the (panel) with a sidebar. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="admin">{children}</div>;
}
