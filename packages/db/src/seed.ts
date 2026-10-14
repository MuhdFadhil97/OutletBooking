/**
 * Local demo data. Safe to run repeatedly (upserts by email / slug).
 *   pnpm db:seed
 */
import { hashPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import { createDb, type Tx } from './client';
import { assertLocalDatabase, loadApiEnv, requireDatabaseUrl } from './env';
import { accounts, businesses, businessMembers, platformAdmins, services, subscriptions, users } from './schema';
import { applyTemplate } from './templates';

const DEMO = {
  owner: { name: 'Muhammad Fadhil', email: 'muhdfadhil.zainal@gmail.com', password: '123', phone: '+60123456789' },
  /** Local FTech super admin for /admin (apps/web). Kept apart from the owner: two-step sign-in is set up on first sign-in. */
  admin: { name: 'FTech Demo Admin', email: 'admin@outletbooking.local', password: 'admin-demo-123' },
  business: {
    slug: 'smash-arena-pj',
    name: 'Smash Arena PJ',
    template: 'sports',
    resourceLabel: 'Court',
    slotIntervalMin: 60,
    phone: '+60123456789',
  },
} as const;

loadApiEnv();
const url = requireDatabaseUrl();
assertLocalDatabase(url);
const { db, sql } = createDb(url, { max: 1 });

/** Upserts a login (user + email/password account) and returns its user id. */
async function upsertLogin(tx: Tx, login: { name: string; email: string; password: string; phone?: string }): Promise<number> {
  const [user] = await tx
    .insert(users)
    .values({ name: login.name, email: login.email, phone: login.phone ?? null, emailVerified: true })
    .onConflictDoUpdate({ target: users.email, set: { name: login.name, phone: login.phone ?? null } })
    .returning({ id: users.id });
  if (!user) throw new Error('Seed: user upsert failed');

  const passwordHash = await hashPassword(login.password);
  const existing = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, 'credential')));
  if (existing[0]) {
    await tx.update(accounts).set({ password: passwordHash }).where(eq(accounts.id, existing[0].id));
  } else {
    await tx.insert(accounts).values({
      userId: user.id,
      accountId: String(user.id),
      providerId: 'credential',
      password: passwordHash,
    });
  }
  return user.id;
}

try {
  await db.transaction(async (tx) => {
    const user = { id: await upsertLogin(tx, DEMO.owner) };

    const [business] = await tx
      .insert(businesses)
      .values(DEMO.business)
      .onConflictDoUpdate({ target: businesses.slug, set: { name: DEMO.business.name } })
      .returning({ id: businesses.id });
    if (!business) throw new Error('Seed: business upsert failed');

    await tx
      .insert(businessMembers)
      .values({ businessId: business.id, userId: user.id, role: 'owner', canViewAll: true })
      .onConflictDoNothing();

    await tx.insert(subscriptions).values({ businessId: business.id }).onConflictDoNothing();

    // Template sample data only on first seed, so owner edits are not duplicated.
    const [anyService] = await tx.select({ id: services.id }).from(services).where(eq(services.businessId, business.id)).limit(1);
    if (!anyService) await applyTemplate(tx, business.id, DEMO.business.template);

    const adminId = await upsertLogin(tx, DEMO.admin);
    await tx
      .insert(platformAdmins)
      .values({ userId: adminId, role: 'super_admin' })
      .onConflictDoUpdate({ target: platformAdmins.userId, set: { role: 'super_admin', isActive: true } });

    console.log(`Seeded "${DEMO.business.name}" (/book/${DEMO.business.slug}); owner login ${DEMO.owner.email}`);
    console.log(`Admin login ${DEMO.admin.email} at /admin/login (apps/web)`);
  });
} finally {
  await sql.end();
}
