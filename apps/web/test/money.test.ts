import { describe, expect, it } from 'vitest';
import { formatRm } from '../lib/money';

describe('formatRm', () => {
  it('formats whole and part ringgit from sen', () => {
    expect(formatRm(4900)).toBe('RM 49');
    expect(formatRm(1250)).toBe('RM 12.50');
    expect(formatRm(0)).toBe('RM 0');
  });
});
