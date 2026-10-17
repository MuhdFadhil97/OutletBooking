import { formatInTimeZone } from 'date-fns-tz';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import {
  adminAuditLog,
  bookings,
  businesses,
  businessMembers,
  customers,
  payments,
  resources,
  services,
  users,
  type Db,
} from '@outletbooking/db';
import type { DataExportResult } from '@outletbooking/shared';
import type { Env } from '../env';
import { AppError, notFound } from '../errors';
import { dataExportEmail } from './billing-emails';
import { csvCell } from './admin';
import type { Mailer } from './mailer';
import { bookingRef } from './payments';

/**
 * I2 "Export data" (FR-21.1): a copy of one business's data, as CSV files that open in Excel, emailed to THAT business's
 * owner at the address on file — never shown on screen to the admin and never sent anywhere else. Used for PDPA access /
 * portability requests and before a business is closed (the M7 notice promises it). Leaves out secrets (ToyyibPay keys),
 * bill codes and other businesses' data. The audit log records that it happened and how many rows, not what was in it.
 */
export interface ExportDeps {
  db: Db;
  env: Env;
  mailer: Mailer;
}

const TZ = 'Asia/Kuala_Lumpur';
/** Resend rejects emails over about 40 MB in total; stay well under. */
const MAX_BYTES = 20 * 1024 * 1024;

const day = (d: Date | null) => (d ? formatInTimeZone(d, TZ, 'yyyy-MM-dd') : '');
const time = (d: Date | null) => (d ? formatInTimeZone(d, TZ, 'yyyy-MM-dd HH:mm') : '');
const rm = (sen: number | null) => (sen === null ? '' : (sen / 100).toFixed(2));

/** One CSV file: UTF-8 with a BOM (so Excel shows names with accents properly), CRLF lines, formula-safe cells. */
function csv(header: string[], rows: (string | number | null)[][]): Buffer {
  const lines = [header, ...rows].map((r) => r.map((c) => csvCell(c === null ? '' : String(c))).join(','));
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}

export async function exportBusinessData(deps: ExportDeps, adminUserId: number, businessId: number, reason: string, now: Date = new Date()): Promise<DataExportResult> {
  const { db } = deps;
  const [biz] = await db.select({ name: businesses.name }).from(businesses).where(and(eq(businesses.id, businessId), isNull(businesses.deletedAt)));
  if (!biz) throw notFound('Business');
  const [owner] = await db
    .select({ email: users.email, name: users.name })
    .from(businessMembers)
    .innerJoin(users, eq(users.id, businessMembers.userId))
    .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.role, 'owner'), eq(businessMembers.isActive, true)))
    .orderBy(asc(businessMembers.id))
    .limit(1);
  if (!owner) throw new AppError(409, 'no_owner', 'This business has no active owner to send the export to');

  const [customerRows, bookingRows, serviceRows, resourceRows, staffRows, paymentRows] = await Promise.all([
    db
      .select({ name: customers.name, phone: customers.phone, email: customers.email, notes: customers.notes, createdAt: customers.createdAt })
      .from(customers)
      .where(and(eq(customers.businessId, businessId), isNull(customers.deletedAt)))
      .orderBy(asc(customers.id)),
    db
      .select({
        token: bookings.publicToken,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        status: bookings.status,
        source: bookings.source,
        priceSen: bookings.priceSen,
        dueSen: bookings.amountDueSen,
        paymentStatus: bookings.paymentStatus,
        address: bookings.locationAddress,
        customerNotes: bookings.customerNotes,
        internalNotes: bookings.internalNotes,
        createdAt: bookings.createdAt,
        service: services.name,
        resource: resources.name,
        customer: customers.name,
        phone: customers.phone,
      })
      .from(bookings)
      .innerJoin(services, and(eq(services.businessId, bookings.businessId), eq(services.id, bookings.serviceId)))
      .innerJoin(resources, and(eq(resources.businessId, bookings.businessId), eq(resources.id, bookings.resourceId)))
      .innerJoin(customers, and(eq(customers.businessId, bookings.businessId), eq(customers.id, bookings.customerId)))
      .where(eq(bookings.businessId, businessId))
      .orderBy(asc(bookings.startAt)),
    db
      .select({ name: services.name, description: services.description, durationMin: services.durationMin, priceSen: services.priceSen, depositSen: services.depositSen, prepayFull: services.prepayFull, visible: services.isVisible })
      .from(services)
      .where(and(eq(services.businessId, businessId), isNull(services.deletedAt)))
      .orderBy(asc(services.sortOrder), asc(services.id)),
    db
      .select({ name: resources.name, type: resources.resourceType, active: resources.isActive })
      .from(resources)
      .where(and(eq(resources.businessId, businessId), isNull(resources.deletedAt)))
      .orderBy(asc(resources.sortOrder), asc(resources.id)),
    db
      .select({ name: users.name, email: users.email, role: businessMembers.role, active: businessMembers.isActive, joinedAt: businessMembers.createdAt })
      .from(businessMembers)
      .innerJoin(users, eq(users.id, businessMembers.userId))
      .where(eq(businessMembers.businessId, businessId))
      .orderBy(asc(businessMembers.id)),
    // The business's own customer payments. Never FTech's plan payments, and no bill codes or provider data.
    db
      .select({ purpose: payments.purpose, method: payments.method, status: payments.status, amountSen: payments.amountSen, paidAt: payments.paidAt, createdAt: payments.createdAt, token: bookings.publicToken })
      .from(payments)
      .leftJoin(bookings, and(eq(bookings.businessId, payments.businessId), eq(bookings.id, payments.bookingId)))
      .where(and(eq(payments.businessId, businessId), ne(payments.purpose, 'subscription')))
      .orderBy(asc(payments.id)),
  ]);

  const files: { filename: string; content: Buffer; rows: number }[] = [
    { filename: 'customers.csv', rows: customerRows.length, content: csv(['Name', 'Phone', 'Email', 'Notes', 'Added'], customerRows.map((c) => [c.name, c.phone, c.email, c.notes, day(c.createdAt)])) },
    {
      filename: 'bookings.csv',
      rows: bookingRows.length,
      content: csv(
        ['Reference', 'Date', 'Start', 'End', 'Service', 'Resource', 'Customer', 'Phone', 'Status', 'Source', 'Price (RM)', 'Amount due (RM)', 'Payment', 'Address', 'Customer notes', 'Internal notes', 'Created'],
        bookingRows.map((b) => [bookingRef(b.token), day(b.startAt), time(b.startAt), time(b.endAt), b.service, b.resource, b.customer, b.phone, b.status, b.source, rm(b.priceSen), rm(b.dueSen), b.paymentStatus, b.address, b.customerNotes, b.internalNotes, time(b.createdAt)]),
      ),
    },
    {
      filename: 'services.csv',
      rows: serviceRows.length,
      content: csv(['Name', 'Description', 'Minutes', 'Price (RM)', 'Deposit (RM)', 'Pay in full online', 'Shown on booking page'], serviceRows.map((s) => [s.name, s.description, s.durationMin, rm(s.priceSen), rm(s.depositSen), s.prepayFull ? 'yes' : 'no', s.visible ? 'yes' : 'no'])),
    },
    { filename: 'resources.csv', rows: resourceRows.length, content: csv(['Name', 'Type', 'Active'], resourceRows.map((r) => [r.name, r.type, r.active ? 'yes' : 'no'])) },
    { filename: 'team.csv', rows: staffRows.length, content: csv(['Name', 'Email', 'Role', 'Active', 'Joined'], staffRows.map((m) => [m.name, m.email, m.role, m.active ? 'yes' : 'no', day(m.joinedAt)])) },
    {
      filename: 'payments.csv',
      rows: paymentRows.length,
      content: csv(['Booking', 'Type', 'Method', 'Status', 'Amount (RM)', 'Paid on', 'Created'], paymentRows.map((p) => [p.token ? bookingRef(p.token) : '', p.purpose, p.method, p.status, rm(p.amountSen), time(p.paidAt), time(p.createdAt)])),
    },
  ];
  if (files.reduce((n, f) => n + f.content.length, 0) > MAX_BYTES) {
    throw new AppError(413, 'export_too_big', 'This export is too big to email. Ask the developer for a download link.');
  }

  const base = deps.env.WEBSITE_URL.replace(/\/+$/, '');
  const email = dataExportEmail({
    businessName: biz.name,
    ownerName: owner.name,
    files: files.map((f) => ({ name: f.filename, rows: f.rows })),
    appUrl: deps.env.APP_PUBLIC_URL.replace(/\/+$/, ''),
    websiteUrl: base,
  });
  try {
    await deps.mailer.send({ to: owner.email, ...email, attachments: files.map((f) => ({ filename: f.filename, content: f.content })) });
  } catch (err) {
    console.error('[export] email failed for business', businessId, err instanceof Error ? err.message : err);
    throw new AppError(502, 'email_failed', 'The export could not be emailed. Nothing was sent; try again in a minute.');
  }
  const counts = Object.fromEntries(files.map((f) => [f.filename.replace('.csv', ''), f.rows]));
  await db.insert(adminAuditLog).values({ adminUserId, businessId, action: 'export_data', reason, details: { ...counts, exportedAt: now.toISOString() } });
  return { sentTo: owner.email, files: files.map((f) => ({ name: f.filename, rows: f.rows })) };
}
