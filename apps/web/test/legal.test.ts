import { describe, expect, it } from 'vitest';
import { loadLegal, pickLanguage, stripDraftHeader } from '../lib/legal';

describe('stripDraftHeader', () => {
  it('drops the title and the drafting note for FTech', () => {
    const md = '# Terms — OutletBooking\n\n> **Draft v0.1** internal note\n>\n> more note\n\n**Last updated:** [date]\n\n## 1. About';
    expect(stripDraftHeader(md)).toBe('**Last updated:** [date]\n\n## 1. About');
  });

  it('handles Windows line endings', () => {
    expect(stripDraftHeader('# T\r\n\r\n> note\r\n\r\nBody')).toBe('Body');
  });
});

describe('pickLanguage', () => {
  const md = '## English\n\nHello\n\n---\n\n## Bahasa Melayu\n\nHalo\n\n---\n\n*Which version prevails*';

  it('returns only the English part', () => {
    expect(pickLanguage(md, 'en')).toBe('Hello');
  });

  it('returns the Bahasa Melayu part with the closing line', () => {
    expect(pickLanguage(md, 'ms')).toBe('Halo\n\n---\n\n*Which version prevails*');
  });
});

describe('loadLegal (docs/legal)', () => {
  it('shows the privacy notice in English and Bahasa Melayu (PDPA s.7(3))', () => {
    const en = loadLegal('privacy', 'en');
    const ms = loadLegal('privacy', 'ms');
    expect(en).toContain('### 1. Who this notice covers');
    expect(en).not.toContain('Siapa yang dilindungi');
    expect(ms).toContain('### 1. Siapa yang dilindungi oleh notis ini');
    expect(ms).not.toContain('Who this notice covers');
  });

  it('never shows the internal drafting note', () => {
    for (const doc of ['privacy', 'terms', 'refund'] as const) {
      const md = loadLegal(doc);
      expect(md).not.toMatch(/prepared by Claude/);
      expect(md.startsWith('#')).toBe(false);
    }
  });
});
