import { formatInTimeZone } from 'date-fns-tz';
import { and, desc, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import {
  adminAuditLog,
  announcementDismissals,
  announcements,
  businesses,
  businessMembers,
  subscriptions,
  users,
  type Db,
} from '@outletbooking/db';
import {
  announcementStatus,
  createAnnouncementSchema,
  type ActiveAnnouncement,
  type AdminAction,
  type AnnouncementAudience,
  type AnnouncementAudienceCount,
  type AnnouncementChannel,
  type AnnouncementRow,
  type AnnouncementType,
  type CreateAnnouncementInput,
} from '@outletbooking/shared';
import { AppError, notFound } from '../errors';
import type { Env } from '../env';
import { renderEmail } from './email-template';
import type { Mailer } from './mailer';
import { pushToUsers } from './notifications';
import type { PushSender } from './push';

/**
 * I28 · Announcements to owners: service messages by email, an in-app banner on Today (O2) and/or push, to all owners,
 * one plan, one business type or one business, now or scheduled. Super admins only (the routes check).
 *
 * "Sending" claims the row first (`sent_at`), then delivers, so a retry or two job runs never send twice. The banner is
 * not delivered anywhere: owners read it from `listActiveAnnouncements` until they dismiss it or `ends_at` passes.
 * Audit rows (`send_announcement`) say what was sent and to how many owners, never the message text.
 */

export interface AnnouncementDeps {
  db: Db;
  env: Env;
  mailer: Mailer;
  push: PushSender;
}

const TZ = 'Asia/Kuala_Lumpur';

interface Owner {
  userId: number;
  email: string;
}

/** Match an announcement's audience against a business (used by SQL for the owner's banner, and for sending). */
const audienceMatches = (audience: AnnouncementAudience, value: string | null) => {
  switch (audience) {
    case 'plan':
      return eq(subscriptions.plan, value ?? '');
    case 'template':
      return eq(businesses.template, value ?? '');
    case 'business':
      return eq(businesses.slug, value ?? '');
    default:
      return undefined;
  }
};

/** One row per owner (someone who owns two businesses gets one message). Closed and deleted businesses are left out. */
export async function audienceOwners(db: Db, audience: AnnouncementAudience, value: string | null): Promise<Owner[]> {
  const rows = await db
    .select({ userId: users.id, email: users.email })
    .from(businessMembers)
    .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
    .innerJoin(users, eq(users.id, businessMembers.userId))
    .leftJoin(subscriptions, eq(subscriptions.businessId, businesses.id))
    .where(
      and(
        eq(businessMembers.role, 'owner'),
        eq(businessMembers.isActive, true),
        isNull(businesses.deletedAt),
        isNull(businesses.closeRequestedAt),
        audienceMatches(audience, value),
      ),
    );
  const seen = new Map<number, Owner>();
  for (const r of rows) if (!seen.has(r.userId)) seen.set(r.userId, { userId: r.userId, email: r.email });
  return [...seen.values()];
}

export async function countAudience(db: Db, audience: AnnouncementAudience, value: string | null): Promise<AnnouncementAudienceCount> {
  return { owners: (await audienceOwners(db, audience, value)).length };
}

async function audit(db: Db, adminUserId: number, summary: string, announcementId: number) {
  const action: AdminAction = 'send_announcement';
  await db.insert(adminAuditLog).values({ adminUserId, businessId: null, action, reason: summary, details: { summary, announcementId } });
}

const channelText = (channels: string[]) => channels.join(', ').replace('in_app', 'in-app banner');

function toRow(r: typeof announcements.$inferSelect & { createdByName: string | null }, now: Date): AnnouncementRow {
  return {
    id: r.id,
    type: r.type as AnnouncementType,
    audience: r.audience as AnnouncementAudience,
    audienceValue: r.audienceValue,
    channels: r.channels as AnnouncementChannel[],
    title: r.title,
    body: r.body,
    sendAt: r.sendAt.toISOString(),
    endsAt: r.endsAt?.toISOString() ?? null,
    sentAt: r.sentAt?.toISOString() ?? null,
    sentCount: r.sentCount,
    status: announcementStatus(r, now),
    createdBy: r.createdByName,
  };
}

/** History, newest first (scheduled ones first). */
export async function listAnnouncements(db: Db, now: Date = new Date()): Promise<AnnouncementRow[]> {
  const rows = await db
    .select({ a: announcements, createdByName: users.name })
    .from(announcements)
    .leftJoin(users, eq(users.id, announcements.createdByUserId))
    .orderBy(desc(announcements.sendAt), desc(announcements.id))
    .limit(100);
  return rows.map((r) => toRow({ ...r.a, createdByName: r.createdByName }, now));
}

function emailFor(a: { type: string; title: string; body: string }, env: Env, test = false) {
  const base = env.WEBSITE_URL.replace(/\/+$/, '');
  return renderEmail({
    subject: `${test ? '[Test] ' : ''}${a.title}`,
    preview: a.body.split('\n')[0]?.slice(0, 120) ?? a.title,
    heading: a.title,
    paragraphs: a.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
    button: { label: 'Open OutletBooking', url: env.APP_PUBLIC_URL.replace(/\/+$/, '') },
    notes: [],
    footer: 'You got this service message because you own a business on OutletBooking.',
    websiteUrl: base,
  });
}

/** Where an announcement is going, in words for the audit log: "all owners", "plan starter", "one business". */
const audienceText = (audience: string, value: string | null) =>
  audience === 'all' ? 'all owners' : audience === 'business' ? `business ${value}` : `${audience} ${value}`;

/**
 * Schedules (or sends, when `sendAt` is now or earlier) an announcement. Refuses an audience nobody is in, so a typo in
 * a business link is caught here and not after "Sent · 0".
 */
export async function createAnnouncement(
  deps: AnnouncementDeps,
  adminUserId: number,
  raw: CreateAnnouncementInput,
  now: Date = new Date(),
): Promise<AnnouncementRow> {
  const input = createAnnouncementSchema.parse(raw);
  const sendAt = input.sendAt ? new Date(input.sendAt) : now;
  if (input.endsAt && Date.parse(input.endsAt) <= now.getTime()) {
    throw new AppError(400, 'ends_in_past', 'The end date must be in the future');
  }
  const owners = await audienceOwners(deps.db, input.audience, input.audienceValue ?? null);
  if (owners.length === 0) {
    throw new AppError(409, 'no_owners', 'No owners match this audience. Check the plan, business type or booking link.');
  }
  const sendNow = sendAt.getTime() <= now.getTime();
  const [created] = await deps.db
    .insert(announcements)
    .values({
      type: input.type,
      audience: input.audience,
      audienceValue: input.audienceValue ?? null,
      channels: input.channels,
      title: input.title,
      body: input.body,
      sendAt: sendNow ? now : sendAt,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      createdByUserId: adminUserId,
    })
    .returning({ id: announcements.id });
  const id = created!.id;
  await audit(
    deps.db,
    adminUserId,
    sendNow
      ? `Announcement #${id} · ${input.type} · ${audienceText(input.audience, input.audienceValue ?? null)} · ${channelText(input.channels)}`
      : `Announcement #${id} scheduled for ${formatInTimeZone(sendAt, TZ, 'd MMM yyyy, h:mm a')} · ${input.type} · ${audienceText(input.audience, input.audienceValue ?? null)}`,
    id,
  );
  if (sendNow) await deliverAnnouncement(deps, id, now);
  return getAnnouncement(deps.db, id, now);
}

export async function getAnnouncement(db: Db, id: number, now: Date = new Date()): Promise<AnnouncementRow> {
  const [row] = await db
    .select({ a: announcements, createdByName: users.name })
    .from(announcements)
    .leftJoin(users, eq(users.id, announcements.createdByUserId))
    .where(eq(announcements.id, id));
  if (!row) throw notFound('Announcement');
  return toRow({ ...row.a, createdByName: row.createdByName }, now);
}

/**
 * Delivers one announcement: claims it (`sent_at`), then emails and pushes the owners it is for. A failed email is logged
 * (never the address or the message) and does not stop the others. Returns the owners reached, or null when someone
 * else already sent it.
 */
export async function deliverAnnouncement(
  deps: AnnouncementDeps,
  id: number,
  now: Date = new Date(),
  /** Sent by the job (a scheduled one), not by the admin's own "Send now": say so in the audit log. */
  byJob = false,
): Promise<number | null> {
  const [claimed] = await deps.db
    .update(announcements)
    .set({ sentAt: now })
    .where(and(eq(announcements.id, id), isNull(announcements.sentAt)))
    .returning();
  if (!claimed) return null;

  const owners = await audienceOwners(deps.db, claimed.audience as AnnouncementAudience, claimed.audienceValue);
  const channels = claimed.channels as AnnouncementChannel[];
  if (channels.includes('email')) {
    const email = emailFor(claimed, deps.env);
    for (const o of owners) {
      try {
        await deps.mailer.send({ to: o.email, ...email });
      } catch (err) {
        console.error('[announcements] email failed for announcement', id, err instanceof Error ? err.message : err);
      }
    }
  }
  if (channels.includes('push')) {
    try {
      await pushToUsers(deps.db, deps.push, owners.map((o) => o.userId), {
        title: claimed.title,
        body: claimed.body.slice(0, 180),
        data: { type: 'announcement', announcementId: id },
      });
    } catch (err) {
      console.error('[announcements] push failed for announcement', id, err instanceof Error ? err.message : err);
    }
  }
  await deps.db.update(announcements).set({ sentCount: owners.length }).where(eq(announcements.id, id));
  // Attributed to whoever scheduled it.
  if (byJob) {
    await audit(deps.db, claimed.createdByUserId, `Announcement #${id} sent to ${owners.length} owner${owners.length === 1 ? '' : 's'}`, id);
  }
  return owners.length;
}

/** Job (every minute): send what was scheduled and is now due. */
export async function dispatchDueAnnouncements(deps: AnnouncementDeps, now: Date = new Date()): Promise<number> {
  const due = await deps.db
    .select({ id: announcements.id })
    .from(announcements)
    .where(and(isNull(announcements.sentAt), lte(announcements.sendAt, now)))
    .orderBy(announcements.sendAt);
  let sent = 0;
  for (const { id } of due) if ((await deliverAnnouncement(deps, id, now, true)) !== null) sent++;
  return sent;
}

/** Take back a scheduled announcement. Once it is sent it cannot be unsent (end the banner by dismissing instead). */
export async function cancelAnnouncement(db: Db, adminUserId: number, id: number): Promise<void> {
  const deleted = await db
    .delete(announcements)
    .where(and(eq(announcements.id, id), isNull(announcements.sentAt)))
    .returning({ id: announcements.id });
  if (!deleted.length) {
    const [exists] = await db.select({ id: announcements.id }).from(announcements).where(eq(announcements.id, id));
    if (!exists) throw notFound('Announcement');
    throw new AppError(409, 'already_sent', 'This announcement was already sent');
  }
  await audit(db, adminUserId, `Announcement #${id} cancelled before it was sent`, id);
}

/** "Send test to me": the email and push go to the admin only; nothing is saved and no banner is shown. */
export async function sendTestAnnouncement(deps: AnnouncementDeps, adminUserId: number, raw: CreateAnnouncementInput): Promise<{ sentTo: string }> {
  const input = createAnnouncementSchema.parse(raw);
  const [me] = await deps.db.select({ email: users.email }).from(users).where(eq(users.id, adminUserId));
  if (!me) throw notFound('Admin');
  if (input.channels.includes('email')) await deps.mailer.send({ to: me.email, ...emailFor(input, deps.env, true) });
  if (input.channels.includes('push')) {
    await pushToUsers(deps.db, deps.push, [adminUserId], { title: `[Test] ${input.title}`, body: input.body.slice(0, 180), data: { type: 'announcement_test' } });
  }
  return { sentTo: me.email };
}

// ------------------------------------------------------------ the owner's banner (Today, O2)

const activeWhere = (businessId: number, userId: number, now: Date, includeDismissed = false) =>
  and(
    isNotNull(announcements.sentAt),
    sql`'in_app' = any(${announcements.channels})`,
    sql`(${announcements.endsAt} is null or ${announcements.endsAt} > ${now.toISOString()})`,
    // Only businesses that existed when it was sent: a new sign-up does not see last month's notice.
    sql`${announcements.sentAt} >= ${businesses.createdAt}`,
    eq(businesses.id, businessId),
    includeDismissed
      ? undefined
      : sql`not exists (select 1 from ${announcementDismissals} d where d.announcement_id = ${announcements.id} and d.user_id = ${userId})`,
    sql`(${announcements.audience} = 'all'
      or (${announcements.audience} = 'plan' and ${announcements.audienceValue} = ${subscriptions.plan})
      or (${announcements.audience} = 'template' and ${announcements.audienceValue} = ${businesses.template})
      or (${announcements.audience} = 'business' and ${announcements.audienceValue} = ${businesses.slug}))`,
  );

/** Banners for this owner's business that they have not dismissed, newest first (a few at most). */
export async function listActiveAnnouncements(db: Db, businessId: number, userId: number, now: Date = new Date()): Promise<ActiveAnnouncement[]> {
  const rows = await db
    .select({ id: announcements.id, type: announcements.type, title: announcements.title, body: announcements.body })
    .from(announcements)
    .innerJoin(businesses, eq(businesses.id, businessId))
    .leftJoin(subscriptions, eq(subscriptions.businessId, businesses.id))
    .where(activeWhere(businessId, userId, now))
    .orderBy(desc(announcements.sentAt), desc(announcements.id))
    .limit(3);
  return rows.map((r) => ({ id: r.id, type: r.type as AnnouncementType, title: r.title, body: r.body }));
}

/** Dismiss a banner (again is fine). Only one meant for this owner's business; anything else is a 404 (rule 10). */
export async function dismissAnnouncement(db: Db, businessId: number, userId: number, id: number, now: Date = new Date()): Promise<void> {
  const rows = await db
    .select({ id: announcements.id })
    .from(announcements)
    .innerJoin(businesses, eq(businesses.id, businessId))
    .leftJoin(subscriptions, eq(subscriptions.businessId, businesses.id))
    .where(and(eq(announcements.id, id), activeWhere(businessId, userId, now, true)));
  if (!rows.length) throw notFound('Announcement');
  await db.insert(announcementDismissals).values({ announcementId: id, userId }).onConflictDoNothing();
}
