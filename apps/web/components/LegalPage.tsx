import Link from 'next/link';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadLegal, type LegalDocKey, type LegalLang } from '@/lib/legal';
import { s } from '@/strings/en';

const TABS: { doc: LegalDocKey; href: string }[] = [
  { doc: 'privacy', href: '/privacy' },
  { doc: 'terms', href: '/terms' },
  { doc: 'refund', href: '/refund' },
];

/** I18 · Privacy notice (English + Bahasa Melayu), terms and refund policy from docs/legal/. */
export function LegalPage({ doc, lang = 'en' }: { doc: LegalDocKey; lang?: LegalLang }) {
  const md = loadLegal(doc, lang);
  return (
    <div className="wrap section" style={{ paddingTop: 32 }}>
      <h1 style={{ fontSize: 32 }}>{s.legal.tabs[doc]}</h1>
      <nav className="tabs" aria-label="Legal documents">
        {TABS.map((t) => (
          <Link key={t.doc} href={t.href} className="chip" aria-current={t.doc === doc ? 'page' : undefined}>
            {s.legal.tabs[t.doc]}
          </Link>
        ))}
      </nav>
      {doc === 'privacy' && (
        <nav className="tabs" aria-label="Language" style={{ marginTop: 0 }}>
          <Link href="/privacy" hrefLang="en" className="chip" aria-current={lang === 'en' ? 'page' : undefined}>
            {s.legal.langs.en}
          </Link>
          <Link href="/privacy/ms" hrefLang="ms" className="chip" aria-current={lang === 'ms' ? 'page' : undefined}>
            {s.legal.langs.ms}
          </Link>
        </nav>
      )}
      <p className="alert alert-ok" style={{ maxWidth: 860, marginBottom: 16 }}>
        {s.legal.draft}
      </p>
      <article className="card prose" lang={lang}>
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            // The files use "##" for sections; keep one h1 per page.
            h1: 'h2',
            table: ({ children }) => (
              <div className="table-scroll">
                <table>{children}</table>
              </div>
            ),
          }}
        >
          {md}
        </Markdown>
      </article>
    </div>
  );
}
