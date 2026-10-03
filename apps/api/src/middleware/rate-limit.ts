import { createMiddleware } from 'hono/factory';
import { getConnInfo } from '@hono/node-server/conninfo';
import { AppError } from '../errors';
import type { AppEnv } from '../types';

interface Options {
  /** Window length in ms */
  windowMs: number;
  /** Max requests per key per window */
  max: number;
  prefix: string;
}

/**
 * Simple in-memory fixed-window limiter (per process). Good enough for one API
 * instance; swap for a Postgres/Redis-backed store when scaling out.
 */
export function rateLimit({ windowMs, max, prefix }: Options) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return createMiddleware<AppEnv>(async (c, next) => {
    if (c.var.env.NODE_ENV === 'test') return next();

    let ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (!ip) {
      try {
        ip = getConnInfo(c).remote.address;
      } catch {
        ip = 'unknown';
      }
    }
    const key = `${prefix}:${ip}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      }
    } else if (++entry.count > max) {
      c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      throw new AppError(429, 'rate_limited', 'Too many requests, please try again shortly');
    }
    await next();
  });
}
