import { eq } from 'drizzle-orm';
import { ADMIN_ROLES, type AdminRole } from '@outletbooking/shared';
import { createDb } from './client';
import { assertLocalDatabase, loadApiEnv, requireDatabaseUrl } from './env';
import { platformAdmins, users } from './schema';

/**
 * Makes an existing login an FTech platform admin: `pnpm db:admin you@example.com [super_admin|support]`
 * (default super_admin — the first admin invites the others in I10). They set up two-step sign-in (I6)
 * the first time they sign in at /admin/login.
 */
loadApiEnv();
const url = requireDatabaseUrl();
assertLocalDatabase(url);

const email = process.argv[2];
const roleArg = process.argv[3] ?? 'super_admin';
const isRole = (v: string): v is AdminRole => ADMIN_ROLES.some((r) => r === v);
if (!email || !isRole(roleArg)) {
  console.error('Usage: pnpm db:admin <email> [super_admin|support]');
  process.exit(1);
}
const role: AdminRole = roleArg;

const { db, sql } = createDb(url, { max: 1 });
try {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!user) {
    console.error(`No user with email ${email}. Sign up first.`);
    process.exitCode = 1;
  } else {
    await db
      .insert(platformAdmins)
      .values({ userId: user.id, role })
      .onConflictDoUpdate({ target: platformAdmins.userId, set: { role, isActive: true } });
    console.log(`${email} is a platform admin (${role}).`);
  }
} finally {
  await sql.end();
}
