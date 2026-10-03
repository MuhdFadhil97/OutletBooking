import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Db } from '@outletbooking/db';
import type { Auth } from './auth';
import type { Env } from './env';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { businessRoutes } from './routes/businesses';
import { healthRoutes } from './routes/health';
import { meRoutes } from './routes/me';
import { signupRoutes } from './routes/signup';
import type { AppEnv } from './types';

export interface AppDeps {
  db: Db;
  auth: Auth;
  env: Env;
}

export function createApp({ db, auth, env }: AppDeps) {
  const app = new Hono<AppEnv>();

  if (env.NODE_ENV === 'development') app.use(logger());

  // Native apps send no Origin; browsers (Expo web, booking page) must be listed.
  const webOrigins = env.TRUSTED_ORIGINS.filter((o) => o.startsWith('http'));
  app.use(
    '*',
    cors({
      origin: (origin) => (webOrigins.includes(origin) ? origin : null),
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization', 'expo-origin'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    }),
  );

  app.use('*', async (c, next) => {
    c.set('db', db);
    c.set('auth', auth);
    c.set('env', env);
    await next();
  });

  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  app.route('/health', healthRoutes);
  app.route('/signup', signupRoutes);
  app.route('/me', meRoutes);
  app.route('/businesses', businessRoutes);

  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  return app;
}
