import { ADMIN_LOCK_MINUTES, type AuditEntry } from '@outletbooking/shared';
import { s } from '../strings/en';
import { formatDate } from './admin-format';

const c = s.admin.audit.change;
const planName = (code: string) => s.admin.plans[code] ?? code;

type Details = AuditEntry['details'];
const str = (d: Details, key: string) => (typeof d[key] === 'string' ? (d[key] as string) : null);
const num = (d: Details, key: string) => (typeof d[key] === 'number' ? (d[key] as number) : null);

/**
 * I9 "Change" column: the before → after saved with an audit entry, in words.
 * Dates are Malaysia time. Unknown or empty details show "—" (the CSV export has the raw JSON).
 */
export function auditChange(entry: Pick<AuditEntry, 'action' | 'details'>): string {
  const d = entry.details;
  switch (entry.action) {
    case 'extend_trial': {
      const from = str(d, 'from');
      const to = str(d, 'to');
      if (!from || !to) break;
      const days = num(d, 'days');
      return c.trialEnd(formatDate(from), formatDate(to)) + (days ? c.plusDays(days) : '');
    }
    case 'give_free_months': {
      const months = num(d, 'months');
      const to = str(d, 'to');
      if (!months || !to) break;
      return c.freeMonths(months, planName(str(d, 'plan') ?? ''), formatDate(to));
    }
    case 'change_plan': {
      const from = str(d, 'from');
      const to = str(d, 'to');
      if (!from || !to) break;
      return c.plan(planName(from), planName(to));
    }
    case 'pause_booking_page':
      return c.pageOff;
    case 'resume_booking_page':
      return c.pageOn;
    case 'resend_link': {
      const link = str(d, 'link');
      return (link && c.link[link]) ?? c.none;
    }
    case 'change_owner': {
      const to = str(d, 'to');
      if (!to) break;
      const old = str(d, 'oldOwner');
      return c.owner(str(d, 'from') ?? c.none, to) + ((old && c.oldOwner[old]) ?? '');
    }
    case 'unsuspend_business': {
      const at = str(d, 'suspendedAt');
      return at ? c.suspendedSince(formatDate(at)) : c.none;
    }
    case 'sign_in': {
      const method = str(d, 'method');
      if (!method) break;
      return (c.signIn[method] ?? method) + (d.firstSetup === true ? c.firstSetup : '');
    }
    case 'update_plans':
    case 'update_platform_settings': {
      // The API writes the readable before → after ("price RM 49 → RM 59; resources 3 → 5").
      const changes = str(d, 'changes');
      if (!changes) break;
      const plan = str(d, 'plan');
      return plan ? `${s.admin.plans[plan] ?? plan}: ${changes}` : changes;
    }
    case 'change_password':
    case 'move_two_factor': {
      const n = num(d, 'signedOutDevices') ?? 0;
      return n > 0 ? `${n} other device${n === 1 ? '' : 's'} signed out` : c.none;
    }
    case 'sign_out_devices': {
      const n = num(d, 'count') ?? 0;
      return n > 0 ? `${n} device${n === 1 ? '' : 's'} signed out` : c.none;
    }
    case 'sign_in_failed':
      if (d.locked === true) return c.locked(ADMIN_LOCK_MINUTES);
      return c.wrongPassword(num(d, 'failures') ?? 1);
    default:
      break;
  }
  return c.none;
}
