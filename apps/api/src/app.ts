import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Db } from '@outletbooking/db';
import type { Auth } from './auth';
import type { Env } from './env';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { bookingFieldRoutes } from './routes/booking-fields';
import { businessRoutes } from './routes/businesses';
import { healthRoutes } from './routes/health';
import { invitationRoutes } from './routes/invitations';
import { meRoutes } from './routes/me';
import { publicRoutes } from './routes/public';
import { resourceRoutes } from './routes/resources';
import { serviceRoutes } from './routes/services';
import { signupRoutes } from './routes/signup';
import { staffRoutes } from './routes/staff';
import { timeOffRoutes } from './routes/time-off';
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
  app.route('/services', serviceRoutes);
  app.route('/resources', resourceRoutes);
  app.route('/time-off', timeOffRoutes);
  app.route('/booking-fields', bookingFieldRoutes);
  app.route('/staff', staffRoutes);
  app.route('/invitations', invitationRoutes);
  app.route('/public', publicRoutes);

  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  return app;
}
