import { describe, expect, it } from 'vitest';
import { addMonthsMalaysia, daysUntil, formatDate, formatDay, formatPhone, timeAgo, whatsappLink, ymdInMalaysia } from '../lib/admin-format';
import { formatRm } from '../lib/money';

describe('admin formatting (Malaysia time)', () => {
  it('shows days in Malaysia, not UTC', () => {
    // 17 Oct 2026 23:30 in Malaysia = 15:30 UTC.
    expect(formatDay('2026-10-17T15:30:00Z')).toBe('Sat, 17 Oct');
    expect(formatDate('2026-10-03T00:00:00Z')).toBe('3 Oct 2026');
    expect(ymdInMalaysia(new Date('2026-10-17T16:30:00Z'))).toBe('2026-10-18');
  });

  it('counts Malaysia calendar days left', () => {
    const now = new Date('2026-10-14T02:00:00Z'); // 10 am Wed 14 Oct
    expect(daysUntil('2026-10-14T15:59:59Z', now)).toBe(0); // 11:59 pm today
    expect(daysUntil('2026-10-17T15:59:59Z', now)).toBe(3);
    expect(daysUntil('2026-10-12T15:59:59Z', now)).toBe(-2);
  });

  it('adds calendar months like the API (Malaysia time)', () => {
    expect(addMonthsMalaysia('2099-01-31T02:00:00.000Z', 1)).toBe('2099-02-28T02:00:00.000Z');
    expect(addMonthsMalaysia('2026-10-16T20:00:00.000Z', 2)).toBe('2026-12-16T20:00:00.000Z'); // 17 Oct 4 am → 17 Dec
    // 1 Mar 1 am in Malaysia (still 28 Feb in UTC) + 1 month = 1 Apr 1 am, not 28 Mar.
    expect(addMonthsMalaysia('2026-02-28T17:00:00.000Z', 1)).toBe('2026-03-31T17:00:00.000Z');
  });

  it('formats phones and WhatsApp links', () => {
    expect(formatPhone('+60123456789')).toBe('+60 12-345 6789');
    expect(formatPhone('+601123456789')).toBe('+60 11-2345 6789');
    expect(formatPhone('+6531234567')).toBe('+6531234567');
    expect(whatsappLink('+60123456789', 'Hi')).toBe('https://wa.me/60123456789?text=Hi');
  });

  it('groups thousands in ringgit', () => {
    expect(formatRm(118800)).toBe('RM 1,188');
    expect(formatRm(123456)).toBe('RM 1,234.56');
  });
});

describe('timeAgo', () => {
  const labels = {
    now: 'just now',
    minutes: (n: number) => `${n} min ago`,
    hours: (n: number) => `${n} h ago`,
    yesterday: 'Yesterday',
    days: (n: number) => `${n} days ago`,
  };
  const now = new Date('2026-10-14T06:00:00Z'); // 2 pm Wed 14 Oct in Malaysia

  it('counts minutes, hours, then Malaysia calendar days', () => {
    expect(timeAgo('2026-10-14T05:59:40Z', labels, now)).toBe('just now');
    expect(timeAgo('2026-10-14T05:40:00Z', labels, now)).toBe('20 min ago');
    expect(timeAgo('2026-10-14T03:30:00Z', labels, now)).toBe('2 h ago');
    // 11 pm Tuesday in Malaysia is 15 h ago in minutes but "Yesterday" on the calendar.
    expect(timeAgo('2026-10-13T15:00:00Z', labels, now)).toBe('Yesterday');
    expect(timeAgo('2026-10-11T06:00:00Z', labels, now)).toBe('3 days ago');
    expect(timeAgo('2026-10-01T06:00:00Z', labels, now)).toBe('1 Oct 2026');
  });
});
