import { formatInTimeZone } from 'date-fns-tz';
import { and, eq, inArray, or } from 'drizzle-orm';
import {
  bookings,
  businesses,
  businessMembers,
  customers,
  pushTokens,
  resources,
  services,
  type Db,
} from '@outletbooking/db';
import type { PushTokenInput } from '@outletbooking/shared';

/** One Expo push message (https://docs.expo.dev/push-notifications/sending-notifications/). */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  channelId?: string;
}

/** Expo push ticket, one per message in the same order. */
export type PushTicket = { status: 'ok'; id: string } | { status: 'error'; message: string; details?: { error?: string } };

export interface PushSender {
  send(messages: PushMessage[]): Promise<PushTicket[]>;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH = 100;

/** Sends through the Expo Push API. `accessToken` is only needed when push security is enabled on the Expo project. */
export function expoPushSender(accessToken?: string): PushSender {
  return {
    async send(messages) {
      const tickets: PushTicket[] = [];
      for (let i = 0; i < messages.length; i += EXPO_BATCH) {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(messages.slice(i, i + EXPO_BATCH)),
        });
        if (!res.ok) throw new Error(`Expo push failed: ${res.status} ${await res.text()}`);
        const json = (await res.json()) as { data: PushTicket[] };
        tickets.push(...json.data);
      }
      return tickets;
    },
  };
}

/** Registers this device for the signed-in user. A token moves to whoever signed in last on the device. */
export async function savePushToken(db: Db, userId: number, input: PushTokenInput): Promise<void> {
  await db
    .insert(pushTokens)
    .values({ userId, token: input.token, platform: input.platform })
    .onConflictDoUpdate({ target: pushTokens.token, set: { userId, platform: input.platform } });
}

/** On logout: stop sending to this device. Only the caller's own token can be removed. */
export async function deletePushToken(db: Db, userId: number, token: string): Promise<void> {
  await db.delete(pushTokens).where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)));
}

export type BookingEvent = 'new' | 'cancelled';

/**
 * FR-10.1: tell the owner(s) and the staff member linked to the booked resource.
 * Only active members of the booking's business receive it.
 */
export async function notifyBooking(db: Db, sender: PushSender, event: BookingEvent, businessId: number, bookingId: number) {
  const [b] = await db
    .select({
      startAt: bookings.startAt,
      timezone: businesses.timezone,
      serviceName: services.name,
      resourceName: resources.name,
      resourceUserId: resources.userId,
      customerName: customers.name,
    })
    .from(bookings)
    .innerJoin(businesses, eq(businesses.id, bookings.businessId))
    .innerJoin(services, and(eq(services.businessId, bookings.businessId), eq(services.id, bookings.serviceId)))
    .innerJoin(resources, and(eq(resources.businessId, bookings.businessId), eq(resources.id, bookings.resourceId)))
    .innerJoin(customers, and(eq(customers.businessId, bookings.businessId), eq(customers.id, bookings.customerId)))
    .where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId)));
  if (!b) return;

  const recipients = await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .innerJoin(businessMembers, eq(businessMembers.userId, pushTokens.userId))
    .where(
      and(
        eq(businessMembers.businessId, businessId),
        eq(businessMembers.isActive, true),
        b.resourceUserId === null
          ? eq(businessMembers.role, 'owner')
          : or(eq(businessMembers.role, 'owner'), eq(businessMembers.userId, b.resourceUserId)),
      ),
    );
  const tokens = [...new Set(recipients.map((r) => r.token))];
  if (!tokens.length) return;

  const when = formatInTimeZone(b.startAt, b.timezone, 'EEE d MMM, h:mm a');
  const title = event === 'new' ? 'New booking' : 'Booking cancelled';
  const body = `${b.customerName} · ${b.serviceName} · ${when} · ${b.resourceName}`;
  const messages = tokens.map((to) => ({
    to,
    title,
    body,
    sound: 'default' as const,
    channelId: 'bookings',
    data: { type: `booking_${event}`, bookingId },
  }));

  const tickets = await sender.send(messages);
  // Uninstalled apps / logged-out devices: stop sending to them.
  const dead = tickets.flatMap((t, i) => (t.status === 'error' && t.details?.error === 'DeviceNotRegistered' ? [tokens[i]!] : []));
  if (dead.length) await db.delete(pushTokens).where(inArray(pushTokens.token, dead));
}

