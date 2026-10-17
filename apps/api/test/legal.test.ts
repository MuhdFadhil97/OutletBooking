import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LEGAL_VERSION,
  PRIVACY_NOTICE,
  PRIVACY_NOTICE_MS,
  REFUND_POLICY,
  TERMS,
  convertLegal,
  findPlaceholders,
  parseSections,
  plain,
  stripDraftHeader,
} from '@outletbooking/shared';
import { LEGAL_GENERATED as GENERATED_FILE } from '../../../packages/shared/src/legal.generated';

/** The app's legal text comes from docs/legal/*.md (the same files the website shows) through `pnpm legal:generate`. */
const read = (name: string) => readFileSync(new URL(`../../../docs/legal/${name}`, import.meta.url), 'utf8');
const source = () => ({ privacy: read('privacy-notice.md'), terms: read('terms-of-service.md'), refund: read('refund-policy.md') });

describe('the generated legal text', () => {
  it('is up to date with docs/legal/*.md — run `pnpm legal:generate` after editing them', () => {
    expect(GENERATED_FILE).toEqual(convertLegal(source()));
    // …and that is what the app shows.
    expect(PRIVACY_NOTICE.sections).toBe(GENERATED_FILE.privacyEn.sections);
    expect(PRIVACY_NOTICE_MS.sections).toBe(GENERATED_FILE.privacyMs.sections);
    expect(TERMS.sections).toBe(GENERATED_FILE.terms.sections);
    expect(REFUND_POLICY.sections).toBe(GENERATED_FILE.refund.sections);
  });

  it('gives the app the privacy notice in English and Bahasa Melayu (PDPA s.7(3)), the terms and the refund policy', () => {
    expect(PRIVACY_NOTICE.title).toBe('Privacy Notice (PDPA)');
    expect(PRIVACY_NOTICE_MS.title).toBe('Notis Privasi (PDPA)');
    expect(TERMS.title).toBe('Terms of Service');
    expect(REFUND_POLICY.title).toBe('Refund Policy');
    for (const doc of [PRIVACY_NOTICE, PRIVACY_NOTICE_MS, TERMS, REFUND_POLICY]) {
      expect(doc.updated).toBe(LEGAL_VERSION);
      expect(doc.sections.length).toBeGreaterThan(5);
    }
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps the two language versions in step: same numbered sections, in the same order', () => {
    const numbers = (sections: { heading: string }[]) => sections.map((s) => /^(\d+)\./.exec(s.heading)?.[1] ?? '-');
    expect(numbers(PRIVACY_NOTICE_MS.sections)).toEqual(numbers(PRIVACY_NOTICE.sections));
    expect(PRIVACY_NOTICE.sections[0]!.heading).toBe('1. Who this notice covers');
    expect(PRIVACY_NOTICE_MS.sections[0]!.heading).toBe('1. Siapa yang dilindungi oleh notis ini');
  });

  it('has no markdown left over, no empty sections and no internal drafting notes', () => {
    for (const doc of [PRIVACY_NOTICE, PRIVACY_NOTICE_MS, TERMS, REFUND_POLICY]) {
      const text = [doc.intro, ...doc.sections.flatMap((s) => [s.heading, ...s.body])].join('\n');
      expect(text).not.toMatch(/\*\*|\|---|\]\(|`|^#{1,6} /m);
      expect(text).not.toMatch(/Draft v0\.1|prepared by Claude|not legal advice/i);
      for (const s of doc.sections) expect(s.body.length, `${doc.title} › ${s.heading}`).toBeGreaterThan(0);
    }
  });

  it('turns the privacy notice’s table into bullets and keeps the "which language prevails" line at the end of both', () => {
    const first = PRIVACY_NOTICE.sections[0]!;
    expect(first.body).toHaveLength(3);
    expect(first.body[0]).toMatch(/^• A business owner or staff member with an OutletBooking account — We do\./);
    for (const doc of [PRIVACY_NOTICE, PRIVACY_NOTICE_MS]) {
      expect(doc.sections.at(-1)!.body[0]).toContain('Bahasa Melayu');
    }
  });
});

describe('the markdown converter', () => {
  it('removes inline marks and keeps link addresses', () => {
    expect(plain('**Bold** and *italic* and `code`')).toBe('Bold and italic and code');
    expect(plain('See [our site](https://outletbooking.my/terms) now')).toBe('See our site (https://outletbooking.my/terms) now');
    expect(plain('A [bracketed] item stays')).toBe('A [bracketed] item stays');
    expect(plain('2 * 3 = 6')).toBe('2 * 3 = 6');
  });

  it('drops the title, the drafting note and the rule after it', () => {
    const md = '# Title\n\n> **Draft** note\n> second line\n\n---\n\n## 1. First\nBody';
    expect(stripDraftHeader(md)).toBe('## 1. First\nBody');
  });

  it('splits sections, joins wrapped lines, and makes bullets, wrapped bullets and table rows', () => {
    const md = [
      'Intro line one',
      'and two.',
      '',
      '### 1. One',
      'Paragraph that',
      'wraps.',
      '- first bullet',
      '  continued here',
      '- second **bold** bullet',
      '',
      '| You are | Who decides |',
      '|---|---|',
      '| An **owner** | We do |',
      '| A visitor | Also us |',
      '',
      '---',
      '',
      '### 2. Two',
      '**Last updated:** [date]',
      'Closing.',
    ].join('\n');
    const parsed = parseSections(md, 3);
    expect(parsed.intro).toBe('Intro line one and two.');
    expect(parsed.sections).toEqual([
      { heading: '1. One', body: ['Paragraph that wraps.', '• first bullet continued here', '• second bold bullet', '• An owner — We do', '• A visitor — Also us'] },
      { heading: '2. Two', body: ['Closing.'] },
    ]);
  });

  it('finds the [bracketed] items still to fill in, but not links or the drafting note', () => {
    const md = '> Replace every [bracketed] item\n\nCompany ([SSM no.]) at [address] — see [terms](https://x.my).\n[decide]';
    expect(findPlaceholders(md)).toEqual([
      { line: 3, text: 'SSM no.' },
      { line: 3, text: 'address' },
      { line: 4, text: 'decide' },
    ]);
  });

  it('refuses a privacy notice that is missing a language', () => {
    expect(() => convertLegal({ privacy: '# T\n\n## English\nx', terms: '', refund: '' })).toThrow(/Bahasa Melayu/);
  });
});
