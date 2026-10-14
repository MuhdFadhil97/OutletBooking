import { describe, expect, it } from 'vitest';
import { errorCodeOf, setupKeyOf } from '../lib/admin-auth';

describe('admin sign-in helpers (I5, I6)', () => {
  it('reads error codes from Better Auth and from our API', () => {
    expect(errorCodeOf({ code: 'INVALID_CODE', message: 'Invalid code' })).toBe('INVALID_CODE');
    expect(errorCodeOf({ error: { code: 'account_locked', message: 'Locked' } })).toBe('account_locked');
    expect(errorCodeOf(null)).toBeNull();
    expect(errorCodeOf('oops')).toBeNull();
  });

  it('shows the setup key in groups of 4', () => {
    const uri = 'otpauth://totp/OutletBooking%20Admin:admin%40ftech.my?secret=JBSWY3DPEHPK3PXPJBSW&issuer=OutletBooking%20Admin';
    expect(setupKeyOf(uri)).toBe('JBSW Y3DP EHPK 3PXP JBSW');
    expect(setupKeyOf('not a uri')).toBe('');
  });
});
