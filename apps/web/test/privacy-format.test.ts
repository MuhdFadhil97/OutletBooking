import { describe, expect, it } from 'vitest';
import { s } from '../strings/en';
import { deadlineText } from '../lib/privacy-format';

const labels = s.admin.privacy.deadline;
const now = new Date('2026-10-14T02:00:00Z'); // 10 am Wed 14 Oct, Malaysia

describe('privacy request deadline wording', () => {
  it('counts Malaysia calendar days and picks the tone', () => {
    expect(deadlineText({ dueAt: '2026-11-04T05:00:00Z', closedAt: null }, labels, now)).toEqual({ text: 'Due in 21 days', tone: 'ok' });
    expect(deadlineText({ dueAt: '2026-10-17T05:00:00Z', closedAt: null }, labels, now)).toEqual({ text: 'Due in 3 days', tone: 'soon' });
    expect(deadlineText({ dueAt: '2026-10-15T05:00:00Z', closedAt: null }, labels, now)).toEqual({ text: 'Due tomorrow', tone: 'soon' });
    expect(deadlineText({ dueAt: '2026-10-14T15:00:00Z', closedAt: null }, labels, now)).toEqual({ text: 'Due today', tone: 'soon' }); // 11 pm today
    expect(deadlineText({ dueAt: '2026-10-13T05:00:00Z', closedAt: null }, labels, now)).toEqual({ text: 'Overdue by 1 day', tone: 'late' });
    expect(deadlineText({ dueAt: '2026-10-10T05:00:00Z', closedAt: null }, labels, now)).toEqual({ text: 'Overdue by 4 days', tone: 'late' });
  });

  it('a finished request shows when it was closed, never overdue', () => {
    expect(deadlineText({ dueAt: '2026-10-01T05:00:00Z', closedAt: '2026-10-03T02:00:00Z' }, labels, now)).toEqual({
      text: 'Closed 3 Oct 2026',
      tone: 'closed',
    });
  });
});
