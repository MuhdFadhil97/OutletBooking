import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { businesses, businessMembers, platformAdmins, sessions, users } from '@outletbooking/db';
import { settleBackground } from '../src/background';
import { createTestContext, signupInput } from './helpers';

/** H6 · Owner changes their login email and mobile number. */
const ctx = createTestContext();
let owner = '';
let ownerB = '';

const body = (res: Response) => res.json() as Promise<{ error: { code: string } }>;
const userOf = async (email: string) => (await ctx.db.select().from(users).where(eq(users.email, email)))[0];
const bizOf = async (slug: string) => (await ctx.db.select().from(businesses).where(eq(businesses.slug, slug)))[0]!;
const requestEmail = (cookie: string, email: string, currentPassword = 'password123') =>
  ctx.send('POST', '/me/email-change', cookie, { email, currentPassword });
const changePhone = (cookie: string, phone: string, currentPassword = 'password123') =>
  ctx.send('PATCH', '/me/phone', cookie, { phone, currentPassword });
/** The confirm link in the last email, followed through the real app (Better Auth's /api/auth/verify-email). */
const openLink = (mail: { text: string }) => {
  const url = new URL(mail.text.match(/https?:\/\/\S+verify-email\S+/)![0]);
  return ctx.app.request(`${url.pathname}${url.search}`);
};

beforeEach(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ slug: 'ali-courts' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'biz-b', phone: '+60111111111' }))).status).toBe(201);
  await settleBackground();
  owner = await ctx.login('ali@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');
  ctx.outbox.length = 0;
});
afterAll(() => ctx.close());

describe('POST /me/email-change', () => {
  it('mails a link to the NEW address and changes nothing until it is opened', async () => {
    expect((await requestEmail(owner, 'new@example.com')).status).toBe(204);
    expect(ctx.outbox).toHaveLength(1);
    expect(ctx.outbox[0]!.to).toBe('new@example.com');
    expect(ctx.outbox[0]!.meta?.template).toBe('change_email');
    expect(await userOf('ali@example.com')).toBeDefined();
    expect(await userOf('new@example.com')).toBeUndefined();
  });

  it('switches the login after the link: new email logs in, old one does not, business email follows', async () => {
    await requestEmail(owner, 'new@example.com');
    const res = await openLink(ctx.outbox[0]!);
    expect(res.status).toBeLessThan(400);
    await settleBackground();

    const user = await userOf('new@example.com');
    expect(user?.emailVerified).toBe(true);
    expect(await userOf('ali@example.com')).toBeUndefined();
    expect((await bizOf('ali-courts')).email).toBe('new@example.com');
    await expect(ctx.login('new@example.com', 'password123')).resolves.toBeTruthy();
    await expect(ctx.login('ali@example.com', 'password123')).rejects.toThrow(/login failed/);

    const notice = ctx.outbox.find((m) => m.meta?.template === 'email_changed');
    expect(notice?.to).toBe('ali@example.com');
    expect(notice?.text).toContain('new@example.com');
  });

  it('leaves the business email alone when the owner had set a different one', async () => {
    await ctx.db.update(businesses).set({ email: 'hello@alicourts.my' }).where(eq(businesses.slug, 'ali-courts'));
    await requestEmail(owner, 'new@example.com');
    await openLink(ctx.outbox[0]!);
    await settleBackground();
    expect((await bizOf('ali-courts')).email).toBe('hello@alicourts.my');
  });

  it('works once: the same link does nothing the second time', async () => {
    await requestEmail(owner, 'new@example.com');
    await openLink(ctx.outbox[0]!);
    await openLink(ctx.outbox[0]!);
    expect(await userOf('new@example.com')).toBeDefined();
    expect(await userOf('ali@example.com')).toBeUndefined();
  });

  describe('logs out other devices once the new email is confirmed', () => {
    const meStatus = async (cookie: string) => (await ctx.get('/me', cookie)).status;
    /** Logins made in beforeEach are seconds old; real ones are older than the "just created" window. */
    const ageSessions = () => ctx.db.update(sessions).set({ createdAt: new Date(Date.now() - 60_000) });
    const openLinkWith = (cookie: string | undefined, mail: { text: string }) => {
      const url = new URL(mail.text.match(/https?:\/\/\S+verify-email\S+/)![0]);
      return ctx.app.request(`${url.pathname}${url.search}`, { headers: cookie ? { cookie } : {} });
    };

    it('opened in a browser with no login: every old session ends, the new login works', async () => {
      const phone = await ctx.login('ali@example.com', 'password123');
      await ageSessions();
      await requestEmail(owner, 'new@example.com');
      expect((await openLinkWith(undefined, ctx.outbox[0]!)).status).toBeLessThan(400);

      expect(await meStatus(owner)).toBe(401);
      expect(await meStatus(phone)).toBe(401);
      expect(await meStatus(ownerB)).toBe(200);
      await expect(ctx.login('new@example.com', 'password123')).resolves.toBeTruthy();
    });

    it('opened by a logged-in device: that device stays logged in, the others end', async () => {
      const phone = await ctx.login('ali@example.com', 'password123');
      await ageSessions();
      await requestEmail(owner, 'new@example.com');
      await openLinkWith(phone, ctx.outbox[0]!);

      expect(await meStatus(phone)).toBe(200);
      expect(await meStatus(owner)).toBe(401);
      expect(await meStatus(ownerB)).toBe(200);
    });
  });

  it('rejects a wrong password and sends nothing', async () => {
    const res = await requestEmail(owner, 'new@example.com', 'not-my-password');
    expect(res.status).toBe(400);
    expect((await body(res)).error.code).toBe('invalid_password');
    expect(ctx.outbox).toHaveLength(0);
  });

  it('rejects an email another account already uses', async () => {
    const res = await requestEmail(owner, 'b@example.com');
    expect(res.status).toBe(409);
    expect((await body(res)).error.code).toBe('email_taken');
    expect(ctx.outbox).toHaveLength(0);
  });

  it('rejects the current email and an invalid one', async () => {
    const same = await requestEmail(owner, 'ALI@example.com');
    expect(same.status).toBe(400);
    expect((await body(same)).error.code).toBe('same_email');
    expect((await requestEmail(owner, 'not-an-email')).status).toBe(400);
  });

  it('is owner only, needs a login and is refused for platform admins', async () => {
    expect((await ctx.post('/me/email-change', { email: 'x@example.com', currentPassword: 'password123' })).status).toBe(401);

    const staffId = await ctx.createUser('Siti', 'siti@example.com');
    await ctx.db.insert(businessMembers).values({ businessId: (await bizOf('ali-courts')).id, userId: staffId, role: 'staff' });
    const staff = await ctx.login('siti@example.com', 'password123');
    expect((await requestEmail(staff, 'siti2@example.com')).status).toBe(403);

    const owner1 = (await userOf('ali@example.com'))!;
    await ctx.db.insert(platformAdmins).values({ userId: owner1.id });
    expect((await requestEmail(owner, 'new@example.com')).status).toBe(403);
    expect(ctx.outbox).toHaveLength(0);
  });

  it('is not reachable through Better Auth directly (no password re-type there)', async () => {
    const res = await ctx.send('POST', '/api/auth/change-email', owner, { newEmail: 'new@example.com' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(ctx.outbox).toHaveLength(0);
  });
});

describe('PATCH /me/phone', () => {
  it('changes the mobile and the business phone / WhatsApp that matched the old one', async () => {
    expect((await changePhone(owner, '+60198765432')).status).toBe(204);
    expect((await userOf('ali@example.com'))?.phone).toBe('+60198765432');
    const biz = await bizOf('ali-courts');
    expect(biz.phone).toBe('+60198765432');
    expect(biz.whatsappPhone).toBe('+60198765432');
  });

  it('leaves a business number the owner had set differently', async () => {
    await ctx.db.update(businesses).set({ phone: '+60355556666' }).where(eq(businesses.slug, 'ali-courts'));
    await changePhone(owner, '+60198765432');
    const biz = await bizOf('ali-courts');
    expect(biz.phone).toBe('+60355556666');
    expect(biz.whatsappPhone).toBe('+60198765432');
  });

  it('never touches another business (tenant isolation)', async () => {
    await changePhone(owner, '+60198765432');
    expect((await bizOf('biz-b')).phone).toBe('+60111111111');
    expect((await userOf('b@example.com'))?.phone).toBe('+60111111111');
    // B changing theirs does not touch A either.
    await changePhone(ownerB, '+60122223333');
    expect((await bizOf('ali-courts')).phone).toBe('+60198765432');
  });

  it('rejects a wrong password, a bad number, a missing login and staff', async () => {
    const wrong = await changePhone(owner, '+60198765432', 'nope');
    expect(wrong.status).toBe(400);
    expect((await body(wrong)).error.code).toBe('invalid_password');
    expect((await changePhone(owner, '012-345')).status).toBe(400);
    expect((await userOf('ali@example.com'))?.phone).toBe('+60123456789');

    expect((await ctx.app.request('/me/phone', { method: 'PATCH' })).status).toBe(401);
    const staffId = await ctx.createUser('Siti', 'siti@example.com');
    await ctx.db.insert(businessMembers).values({ businessId: (await bizOf('ali-courts')).id, userId: staffId, role: 'staff' });
    expect((await changePhone(await ctx.login('siti@example.com', 'password123'), '+60198765432')).status).toBe(403);
  });
});
