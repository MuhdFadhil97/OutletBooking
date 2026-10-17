import { describe, expect, it } from 'vitest';
import { malaysiaLocalToIso } from '../lib/announcement-format';

describe('announcement times', () => {
  it('reads a datetime-local value as Malaysia time', () => {
    expect(malaysiaLocalToIso('2026-10-25T02:00')).toBe('2026-10-24T18:00:00.000Z');
    expect(malaysiaLocalToIso('2026-10-25T02:00:30')).toBe('2026-10-24T18:00:30.000Z');
    expect(malaysiaLocalToIso('2026-01-01T00:30')).toBe('2025-12-31T16:30:00.000Z');
  });
});
