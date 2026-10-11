import { eq } from 'drizzle-orm';
import { createDb } from './client';
import { assertLocalDatabase, loadApiEnv, requireDatabaseUrl } from './env';
import { platformAdmins, users } from './schema';

/** Makes an existing login an FTech platform admin (I1/I2): `pnpm db:admin you@example.com` */
loadApiEnv();
const url = requireDatabaseUrl();
assertLocalDatabase(url);

const email = process.argv[2];
if (!email) {
  console.error('Usage: pnpm db:admin <email>');
  process.exit(1);
}

const { db, sql } = createDb(url, { max: 1 });
try {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!user) {
    console.error(`No user with email ${email}. Sign up first.`);
    process.exitCode = 1;
  } else {
    await db.insert(platformAdmins).values({ userId: user.id }).onConflictDoNothing();
    console.log(`${email} is a platform admin.`);
  }
} finally {
  await sql.end();
}
