import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { leads } from '@outletbooking/db';
import type { LeadCreateInput } from '@outletbooking/shared';
import { createTestContext } from './helpers';

const ctx = createTestContext();

beforeAll(() => ctx.reset());
afterAll(() => ctx.close());

const lead = (over: Partial<LeadCreateInput> = {}): LeadCreateInput => ({
  reason: 'demo',
  name: 'Aina',
  businessName: 'Smash Arena PJ',
  phone: '+60123456789',
  email: '',
  businessType: 'sports',
  resourceCount: '6 courts',
  message: '',
  consent: true,
  ...over,
});

describe('POST /public/leads (I19 contact form)', () => {
  it('saves the lead without logging in, with the consent time', async () => {
    const before = Date.now();
    const res = await ctx.post('/public/leads', lead());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });

    const rows = await ctx.db.select().from(leads);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reason: 'demo',
      name: 'Aina',
      businessName: 'Smash Arena PJ',
      phone: '+60123456789',
      email: null,
      businessType: 'sports',
      resourceCount: '6 courts',
      message: null,
      status: 'new',
    });
    expect(rows[0]!.consentAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('accepts an email instead of a mobile number', async () => {
    const res = await ctx.post('/public/leads', lead({ reason: 'question', phone: '', email: 'owner@example.com' }));
    expect(res.status).toBe(201);
  });

  it('refuses a lead without consent', async () => {
    const res = await ctx.post('/public/leads', { ...lead(), consent: false });
    expect(res.status).toBe(400);
  });

  it('needs a mobile number or an email', async () => {
    const res = await ctx.post('/public/leads', lead({ phone: '', email: '' }));
    expect(res.status).toBe(400);
  });

  it('refuses a mobile number that is not E.164', async () => {
    const res = await ctx.post('/public/leads', lead({ phone: '0123456789' }));
    expect(res.status).toBe(400);
  });

  it('refuses an unknown reason', async () => {
    const res = await ctx.post('/public/leads', { ...lead(), reason: 'spam' });
    expect(res.status).toBe(400);
  });
});
