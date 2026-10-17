import { PRIVACY_DUE_SOON_DAYS } from '@outletbooking/shared';
import { daysUntil, formatDate } from './admin-format';

export type DeadlineTone = 'late' | 'soon' | 'ok' | 'closed';

export interface DeadlineLabels {
  today: string;
  tomorrow: string;
  in: (n: number) => string;
  overdueBy: (n: number) => string;
  closed: (day: string) => string;
}

/**
 * How a privacy request's deadline reads in the list: "Due in 16 days", "Due tomorrow", "Overdue by 2 days", or
 * "Closed 3 Sep" once it is finished. Malaysia calendar days, like the API's due-soon rule.
 */
export function deadlineText(
  req: { dueAt: string; closedAt: string | null },
  labels: DeadlineLabels,
  now: Date = new Date(),
): { text: string; tone: DeadlineTone } {
  if (req.closedAt) return { text: labels.closed(formatDate(req.closedAt)), tone: 'closed' };
  const days = daysUntil(req.dueAt, now);
  if (days < 0) return { text: labels.overdueBy(-days), tone: 'late' };
  const tone: DeadlineTone = days <= PRIVACY_DUE_SOON_DAYS ? 'soon' : 'ok';
  if (days === 0) return { text: labels.today, tone };
  if (days === 1) return { text: labels.tomorrow, tone };
  return { text: labels.in(days), tone };
}
