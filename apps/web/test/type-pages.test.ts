import { BUSINESS_TEMPLATES } from '@outletbooking/shared';
import { describe, expect, it } from 'vitest';
import { s, TYPE_PAGE_SLUGS } from '../strings/en';

describe('business-type pages (I21–I23)', () => {
  it('maps every slug to a real business template with full copy', () => {
    for (const template of Object.values(TYPE_PAGE_SLUGS)) {
      expect(BUSINESS_TEMPLATES).toContain(template);
      const copy = s.typePage.pages[template];
      expect(copy.title).not.toBe('');
      expect(copy.preview.rows).toHaveLength(4);
      expect(copy.features).toHaveLength(4);
      expect(copy.steps).toHaveLength(4);
      expect(copy.faq).toHaveLength(3);
    }
  });

  it('gives every landing card a Learn more page', () => {
    for (const card of s.home.types) {
      expect(card.slug, card.title).toBeDefined();
      expect(Object.hasOwn(TYPE_PAGE_SLUGS, card.slug as string)).toBe(true);
    }
  });
});
