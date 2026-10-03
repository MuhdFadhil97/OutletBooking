/**
 * Local demo data. Safe to run repeatedly (upserts by email / slug).
 *   pnpm db:seed
 */
import { hashPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import { createDb } from './client';
import { assertLocalDatabase, loadApiEnv, requireDatabaseUrl } from './env';
import { accounts, businesses, businessMembers, subscriptions, users } from './schema';

const DEMO = {
  owner: { name: 'Muhammad Fadhil', email: 'muhdfadhil.zainal@gmail.com', password: '123', phone: '+60123456789' },
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

try {
  await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name: DEMO.owner.name, email: DEMO.owner.email, phone: DEMO.owner.phone, emailVerified: true })
      .onConflictDoUpdate({ target: users.email, set: { name: DEMO.owner.name, phone: DEMO.owner.phone } })
      .returning({ id: users.id });
    if (!user) throw new Error('Seed: user upsert failed');

    const passwordHash = await hashPassword(DEMO.owner.password);
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

    console.log(`Seeded "${DEMO.business.name}" (/book/${DEMO.business.slug}); owner login ${DEMO.owner.email}`);
  });
} finally {
  await sql.end();
}
