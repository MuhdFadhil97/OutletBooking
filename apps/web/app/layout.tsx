import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import type { ReactNode } from 'react';
import { s } from '@/strings/en';
import './globals.css';

const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap' });

export const metadata: Metadata = {
  title: s.home.metaTitle,
  description: s.home.metaDescription,
};

export const viewport: Viewport = {
  themeColor: '#0F7B55',
};

/** Website pages add the header and footer in (site)/layout.tsx; /admin has its own shell. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body>{children}</body>
    </html>
  );
}
