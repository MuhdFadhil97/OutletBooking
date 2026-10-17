/**
 * Turns the legal documents in `docs/legal/*.md` into the plain "heading + paragraphs" shape the app shows (`LegalDoc`).
 * The markdown files are the single source of truth: the website renders them directly, and `pnpm legal:generate` runs
 * this converter to write `legal.generated.ts` for the app, so the two can never say different things.
 *
 * It only understands the small subset those files use: `#` / `##` / `###` headings, paragraphs, `- ` bullets, pipe tables
 * (each row becomes one bullet), `---` rules, a leading `>` drafting note, and **bold** / *italic* / `code` / [links](url).
 */

export interface LegalSection {
  heading: string;
  /** Paragraphs; lines starting with "• " render as bullets. */
  body: string[];
}

export interface ParsedLegal {
  intro: string;
  sections: LegalSection[];
}

/** Markdown inline marks → plain text. A link keeps its address in brackets so it stays useful on a phone. */
export function plain(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|[\s(])\*(?!\s)(.+?)(?<!\s)\*(?=$|[\s).,;:])/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Drops the H1 title, the "> Draft…" note for FTech and the rule after it. */
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
  if (lines[i]?.trim() === '---') i++;
  skipBlank();
  return lines.slice(i).join('\n').trim();
}

/** "**Last updated:** [date]" / "**Kemas kini terakhir:** [tarikh]" — the app shows its own version date instead. */
const UPDATED_LINE = /^\*\*(Last updated|Kemas kini terakhir):\*\*.*$/gim;

const isBullet = (l: string) => /^\s*[-*] +\S/.test(l);
const isTableRow = (l: string) => l.trim().startsWith('|');
const isRule = (l: string) => /^\s*---+\s*$/.test(l);

/** Splits markdown into sections at headings of exactly `level` (2 = "## ", 3 = "### "). Text before the first one is the intro. */
export function parseSections(md: string, level: 2 | 3): ParsedLegal {
  const marker = '#'.repeat(level) + ' ';
  const lines = md.replace(/\r\n/g, '\n').replace(UPDATED_LINE, '').split('\n');
  const intro: string[] = [];
  const sections: LegalSection[] = [];
  let current: string[] = intro;
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length) current.push(plain(paragraph.join(' ')));
    paragraph = [];
  };

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!;
    if (line.startsWith(marker)) {
      flush();
      const section: LegalSection = { heading: plain(line.slice(marker.length)), body: [] };
      sections.push(section);
      current = section.body;
    } else if (line.trim() === '' || isRule(line)) {
      flush();
    } else if (isBullet(line)) {
      flush();
      current.push(`• ${plain(line.replace(/^\s*[-*] +/, ''))}`);
    } else if (isTableRow(line)) {
      flush();
      const rows: string[][] = [];
      while (n < lines.length && isTableRow(lines[n]!)) {
        const cells = lines[n]!.trim().replace(/^\||\|$/g, '').split('|').map((c) => plain(c));
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        n++;
      }
      n--;
      // First row is the header: each row after it reads "first column — the rest".
      for (const [first, ...rest] of rows.slice(1)) current.push(`• ${[first, rest.join(' · ')].filter(Boolean).join(' — ')}`);
    } else if (/^\s{2,}\S/.test(line) && current.length && current[current.length - 1]!.startsWith('• ') && paragraph.length === 0) {
      // A wrapped line of the bullet above.
      current[current.length - 1] = `${current[current.length - 1]} ${plain(line)}`;
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return { intro: intro.filter(Boolean).join('\n\n'), sections: sections.filter((s) => s.body.length > 0 || s.heading) };
}

/** Everything in `[square brackets]` that is not a link: the items FTech or the lawyer must still fill in or decide. */
export function findPlaceholders(md: string): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = [];
  md.replace(/\r\n/g, '\n')
    .split('\n')
    .forEach((line, i) => {
      if (line.startsWith('>')) return; // the drafting note mentions "[bracketed]" itself
      for (const m of line.matchAll(/\[([^\]]+)\](?!\()/g)) found.push({ line: i + 1, text: m[1]! });
    });
  return found;
}

export interface LegalSource {
  /** docs/legal/privacy-notice.md */
  privacy: string;
  /** docs/legal/terms-of-service.md */
  terms: string;
  /** docs/legal/refund-policy.md */
  refund: string;
}

export interface GeneratedLegal {
  privacyEn: ParsedLegal;
  privacyMs: ParsedLegal;
  terms: ParsedLegal;
  refund: ParsedLegal;
}

/** The closing "which language prevails" line sits after the last rule of the Bahasa Melayu half and covers both. */
function splitPrivacy(md: string): { en: string; ms: string; note: string } {
  const body = stripDraftHeader(md);
  const en = body.indexOf('## English');
  const ms = body.indexOf('## Bahasa Melayu');
  if (en === -1 || ms === -1) throw new Error('The privacy notice needs both "## English" and "## Bahasa Melayu" (PDPA s.7(3)).');
  const msPart = body.slice(ms).replace(/^## .*\n/, '');
  const lastRule = msPart.lastIndexOf('\n---\n');
  return {
    en: body.slice(en, ms).replace(/^## .*\n/, ''),
    ms: lastRule === -1 ? msPart : msPart.slice(0, lastRule),
    note: lastRule === -1 ? '' : msPart.slice(lastRule + 5).trim(),
  };
}

export function convertLegal(src: LegalSource): GeneratedLegal {
  const privacy = splitPrivacy(src.privacy);
  const note = privacy.note ? plain(privacy.note) : '';
  const en = parseSections(privacy.en, 3);
  const ms = parseSections(privacy.ms, 3);
  if (note) {
    en.sections.push({ heading: 'If the languages differ', body: [note] });
    ms.sections.push({ heading: 'Jika bahasa berbeza', body: [note] });
  }
  return {
    privacyEn: en,
    privacyMs: ms,
    terms: parseSections(stripDraftHeader(src.terms), 2),
    refund: parseSections(stripDraftHeader(src.refund), 2),
  };
}
