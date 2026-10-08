import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Db } from '@outletbooking/db';
import type { Auth } from './auth';
import type { Env } from './env';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { bookingFieldRoutes } from './routes/booking-fields';
import { bookingRoutes } from './routes/bookings';
import { businessRoutes } from './routes/businesses';
import { healthRoutes } from './routes/health';
import { invitationRoutes } from './routes/invitations';
import { meRoutes } from './routes/me';
import { notificationRoutes, pushTokenRoutes } from './routes/notifications';
import { paymentAccountRoutes, toyyibpayRoutes } from './routes/payments';
import { passwordRoutes } from './routes/password';
import { publicRoutes } from './routes/public';
import { resourceRoutes } from './routes/resources';
import { serviceRoutes } from './routes/services';
import { signupRoutes } from './routes/signup';
import { staffRoutes } from './routes/staff';
import { timeOffRoutes } from './routes/time-off';
import { createPaymentDeps } from './services/payments';
import { createPushSender, type PushSender } from './services/push';
import type { ToyyibPayClient } from './services/toyyibpay';
import type { AppEnv } from './types';

export interface AppDeps {
  db: Db;
  auth: Auth;
  env: Env;
  /** Defaults to Expo push (off in tests). */
  push?: PushSender;
  /** Defaults to the real ToyyibPay API at TOYYIBPAY_BASE_URL. */
  toyyibpay?: ToyyibPayClient;
}

export function createApp({ db, auth, env, push = createPushSender(env), toyyibpay }: AppDeps) {
  const payments = createPaymentDeps(env, toyyibpay);
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
    c.set('push', push);
    c.set('payments', payments);
    await next();
  });

  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  app.route('/health', healthRoutes);
  app.route('/signup', signupRoutes);
  app.route('/password', passwordRoutes);
  app.route('/me', meRoutes);
  app.route('/businesses', businessRoutes);
  app.route('/services', serviceRoutes);
  app.route('/resources', resourceRoutes);
  app.route('/time-off', timeOffRoutes);
  app.route('/booking-fields', bookingFieldRoutes);
  app.route('/staff', staffRoutes);
  app.route('/invitations', invitationRoutes);
  app.route('/bookings', bookingRoutes);
  app.route('/public', publicRoutes);
  app.route('/notifications', notificationRoutes);
  app.route('/push-tokens', pushTokenRoutes);
  app.route('/payment-account', paymentAccountRoutes);
  app.route('/payments/toyyibpay', toyyibpayRoutes);

  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  return app;
}
