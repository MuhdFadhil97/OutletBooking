import type { AdminBusinessRow } from '@outletbooking/shared';
import { daysUntil, formatDay } from '@/lib/admin-format';
import { s } from '@/strings/en';

const t = s.admin;

const TAG_CLASS: Record<AdminBusinessRow['state'], string> = {
  trial: 'tag tag-blue',
  pilot: 'tag tag-pend',
  paying: 'tag',
  ended: 'tag tag-gray',
};

/** Plan name for a paying business ("Business"), from subscriptions.plan. */
export const planName = (plan: string | undefined) => (plan && t.plans[plan]) || plan || '';

/** On free months given by FTech right now (no payment until they end). */
export function isFree(b: AdminBusinessRow, now: Date = new Date()): boolean {
  const free = b.subscription?.freeUntil;
  return b.state === 'paying' && !!free && Date.parse(free) > now.getTime();
}

/** When the trial ends, the plan renews, or it ended. */
export function endDate(b: AdminBusinessRow): string | null {
  const sub = b.subscription;
  if (!sub) return null;
  if (b.state === 'paying') return sub.currentPeriodEnd ?? sub.trialEndsAt;
  if (b.state === 'ended' && sub.status !== 'trialing') return sub.currentPeriodEnd ?? sub.trialEndsAt;
  return sub.trialEndsAt;
}

/** I1 "Status" column: "Trial · 5 days", "Pilot", "Business", "Trial ended". */
export function StateTag({ business, now }: { business: AdminBusinessRow; now?: Date }) {
  const end = endDate(business);
  const label =
    business.state === 'trial' && end
      ? `${t.state.trial} · ${t.businesses.daysLeft(daysUntil(end, now))}`
      : business.state === 'paying'
        ? planName(business.subscription?.plan)
        : t.state[business.state];
  return <span className={TAG_CLASS[business.state]}>{label}</span>;
}

/** I1 "Trial / renews" column. */
export function untilLabel(b: AdminBusinessRow): string {
  const end = endDate(b);
  if (!end) return '—';
  const day = formatDay(end);
  if (b.state === 'pilot') return t.businesses.extendedTo(day);
  if (b.state === 'paying') return isFree(b) ? t.businesses.freeUntil(day) : t.businesses.renews(day);
  if (b.state === 'ended') return t.businesses.endedOn(day);
  return day;
}
