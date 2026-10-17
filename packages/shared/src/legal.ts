import { LEGAL_GENERATED } from './legal.generated';
import type { LegalSection } from './legal-markdown';

export type { LegalSection };

/**
 * Privacy Notice (PDPA 2010) + Terms of Use. Shared so the app (`/privacy`, `/terms`), the
 * website (Phase 7) and the API (consent version) use the same text.
 *
 * The text is NOT written here: it comes from docs/legal/*.md (English and Bahasa Melayu privacy notice, terms, refund policy)
 * through `pnpm legal:generate`, the same files the website shows. Those files are still a DRAFT with [bracketed] items:
 * run `pnpm legal:placeholders` to list them, and have a Malaysian lawyer review before launch.
 *
 * Bump `LEGAL_VERSION` whenever the meaning changes; users store the version they agreed to.
 */
export const LEGAL_VERSION = '2026-10-17';
export const LEGAL_COMPANY = 'FTech IT Consulting Sdn Bhd';
export const LEGAL_PRODUCT = 'OutletBooking';

export interface LegalDoc {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}

const doc = (title: string, parsed: { intro: string; sections: LegalSection[] }): LegalDoc => ({
  title,
  updated: LEGAL_VERSION,
  intro: parsed.intro,
  sections: parsed.sections,
});

export const PRIVACY_NOTICE: LegalDoc = doc('Privacy Notice (PDPA)', LEGAL_GENERATED.privacyEn);
/** PDPA s.7(3): the notice must also be given in Bahasa Melayu. */
export const PRIVACY_NOTICE_MS: LegalDoc = doc('Notis Privasi (PDPA)', LEGAL_GENERATED.privacyMs);
export const TERMS: LegalDoc = doc('Terms of Service', LEGAL_GENERATED.terms);
export const REFUND_POLICY: LegalDoc = doc('Refund Policy', LEGAL_GENERATED.refund);
