import { describe, expect, it } from 'vitest';
import { auditParams } from '../lib/admin-api';
import { auditChange } from '../lib/audit-format';

describe('I9 audit "Change" column', () => {
  it('trial extended: before → after in Malaysia days, with the days added', () => {
    expect(
      auditChange({
        action: 'extend_trial',
        details: { from: '2026-10-17T15:59:59.999Z', to: '2026-11-16T15:59:59.999Z', days: 30, previousStatus: 'trialing' },
      }),
    ).toBe('Trial end 17 Oct 2026 → 16 Nov 2026 (+30 days)');
    expect(
      auditChange({ action: 'extend_trial', details: { from: '2026-10-07T16:00:00Z', to: '2026-11-30T15:59:59Z', days: null } }),
    ).toBe('Trial end 8 Oct 2026 → 30 Nov 2026');
  });

  it('plans, free months, booking page, links, owner', () => {
    expect(auditChange({ action: 'change_plan', details: { from: 'starter', to: 'business' } })).toBe('Starter → Business');
    expect(auditChange({ action: 'give_free_months', details: { months: 1, plan: 'business', to: '2026-11-11T02:00:00Z' } })).toBe(
      '1 free month · Business until 11 Nov 2026',
    );
    expect(auditChange({ action: 'pause_booking_page', details: {} })).toBe('Booking page live → paused');
    expect(auditChange({ action: 'resend_link', details: { link: 'password_reset' } })).toBe('Password reset link');
    expect(
      auditChange({ action: 'change_owner', details: { from: 'a@x.my', to: 'b@x.my', oldOwner: 'staff', proof: 'SSM' } }),
    ).toBe('a@x.my → b@x.my · old owner kept as staff');
  });

  it('plans & prices and platform settings show the saved before → after', () => {
    expect(
      auditChange({ action: 'update_plans', details: { plan: 'starter', changes: 'price RM 49 → RM 59; resources 3 → 5' } }),
    ).toBe('Starter: price RM 49 → RM 59; resources 3 → 5');
    expect(auditChange({ action: 'update_platform_settings', details: { changes: 'trial 7 → 14 days' } })).toBe('trial 7 → 14 days');
    expect(auditChange({ action: 'update_plans', details: {} })).toBe('—');
  });

  it('my account changes show how many devices were signed out', () => {
    expect(auditChange({ action: 'change_password', details: { signedOutDevices: 2 } })).toBe('2 other devices signed out');
    expect(auditChange({ action: 'move_two_factor', details: { signedOutDevices: 1 } })).toBe('1 other device signed out');
    expect(auditChange({ action: 'sign_out_devices', details: { count: 3 } })).toBe('3 devices signed out');
    expect(auditChange({ action: 'new_backup_codes', details: {} })).toBe('—');
  });

  it('sign-ins', () => {
    expect(auditChange({ action: 'sign_in', details: { method: 'totp', firstSetup: true } })).toBe('Two-step code · two-step set up');
    expect(auditChange({ action: 'sign_in_failed', details: { failures: 2, locked: false } })).toBe('Wrong password (2 in a row)');
    expect(auditChange({ action: 'sign_in_failed', details: { failures: 5, locked: true } })).toBe('Locked for 15 minutes');
  });

  it('shows "—" when there is nothing to show or the details are unexpected', () => {
    expect(auditChange({ action: 'note', details: {} })).toBe('—');
    expect(auditChange({ action: 'extend_trial', details: { from: 3 } })).toBe('—');
    expect(auditChange({ action: 'record_payment', details: { amountSen: 9900 } })).toBe('—');
  });
});

describe('auditParams', () => {
  it('leaves out empty filters', () => {
    expect(auditParams({ adminId: 3, action: 'note', business: undefined, from: '2026-10-01' }).toString()).toBe(
      'adminId=3&action=note&from=2026-10-01',
    );
  });
});
