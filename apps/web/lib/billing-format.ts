import { formatDate } from './admin-format';

const timeFormat = new Intl.DateTimeFormat('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: 'numeric', minute: '2-digit', hour12: true });

/** "11 Oct 2026, 9:41 am" in Malaysia time. */
export const formatPaidAt = (iso: string) => `${formatDate(iso)}, ${timeFormat.format(new Date(iso))}`;

/** "17 Oct – 16 Nov 2026" from a payment description like "Business plan · 17 Oct – 16 Nov 2026". */
export const periodOf = (description: string) => description.split(' · ')[1] ?? '';

/** "0:42" for a countdown in seconds. */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
