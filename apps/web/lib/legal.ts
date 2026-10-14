import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * I18 legal pages render the drafts in docs/legal/*.md (read at build time).
 * Each file starts with "# Title" and a "> Draft…" note for FTech; both are left out of the page.
 */

export const LEGAL_DOCS = ['privacy', 'terms', 'refund'] as const;
export type LegalDocKey = (typeof LEGAL_DOCS)[number];
export type LegalLang = 'en' | 'ms';

const FILES: Record<LegalDocKey, string> = {
  privacy: 'privacy-notice.md',
  terms: 'terms-of-service.md',
  refund: 'refund-policy.md',
};

const LEGAL_DIR = path.join(process.cwd(), '../../docs/legal');

/** Drops the H1 and the leading blockquote (internal drafting note). */
export function stripDraftHeader(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  const skipBlank = () => {
    while (i < lines.length && lines[i]!.trim() === '') i++;
  };
  skipBlank();
  if (lines[i]?.startsWith('# ')) i++;
  skipBlank();
  while (i < lines.length && lines[i]!.startsWith('>')) i++;
  skipBlank();
  return lines.slice(i).join('\n').trim();
}

/**
 * The privacy notice holds both languages ("## English" … "## Bahasa Melayu" …), as PDPA s.7(3) requires.
 * Returns one language; the closing "which version prevails" line is kept on both.
 */
export function pickLanguage(md: string, lang: LegalLang): string {
  const en = md.indexOf('## English');
  const ms = md.indexOf('## Bahasa Melayu');
  if (en === -1 || ms === -1) return md;
  const dropHeading = (s: string) => s.replace(/^## .*\n/, '');
  const trimRule = (s: string) => s.trim().replace(/\n---$/, '').trim();
  if (lang === 'en') return trimRule(dropHeading(md.slice(en, ms)));
  const rest = md.slice(ms);
  const lastRule = rest.lastIndexOf('\n---\n');
  if (lastRule === -1) return trimRule(dropHeading(rest));
  return `${trimRule(dropHeading(rest.slice(0, lastRule)))}\n\n---\n\n${rest.slice(lastRule + 5).trim()}`;
}

export function loadLegal(doc: LegalDocKey, lang: LegalLang = 'en'): string {
  const body = stripDraftHeader(readFileSync(path.join(LEGAL_DIR, FILES[doc]), 'utf8'));
  return doc === 'privacy' ? pickLanguage(body, lang) : body;
}
