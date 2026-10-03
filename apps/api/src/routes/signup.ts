import { Hono } from 'hono';
import { signupSchema, slugAvailabilityQuery } from '@outletbooking/shared';
import { rateLimit } from '../middleware/rate-limit';
import { checkSlugAvailability } from '../services/slugs';
import { signupOwner } from '../services/signup';
import type { AppEnv } from '../types';
import { validate } from '../validate';

export const signupRoutes = new Hono<AppEnv>()
  .get(
    '/slug-available',
    rateLimit({ prefix: 'slug', windowMs: 60_000, max: 60 }),
    validate('query', slugAvailabilityQuery),
    async (c) => c.json(await checkSlugAvailability(c.var.db, c.req.valid('query').slug)),
  )
  .post(
    '/',
    rateLimit({ prefix: 'signup', windowMs: 60 * 60_000, max: 10 }),
    validate('json', signupSchema),
    async (c) => {
      const result = await signupOwner(c.var.db, c.req.valid('json'));
      // No session here: the app signs in through Better Auth right after (secure storage handled by the Expo client).
      return c.json({ slug: result.slug, trialEndsAt: result.trialEndsAt.toISOString() }, 201);
    },
  );
