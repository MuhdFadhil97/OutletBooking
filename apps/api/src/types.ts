import type { Db } from '@outletbooking/db';
import type { AdminMe, MemberRole } from '@outletbooking/shared';
import type { Auth, AuthSession } from './auth';
import type { Env } from './env';
import type { Mailer } from './services/mailer';
import type { PushSender } from './services/push';
import type { ObjectStorage } from './services/storage';
import type { ToyyibPayClient } from './services/toyyibpay';

/** Resolved from business_members on every authenticated request — never from the client. */
export interface Tenant {
  businessId: number;
  memberId: number;
  role: MemberRole;
  /** Owners always have every permission. */
  canViewAll: boolean;
  /** Record cash / DuitNow / card payments. */
  canTakePayments: boolean;
  /** Services, prices, hours, time off, booking questions. */
  canEditSetup: boolean;
  /** Trial running or plan paid. False = view only (no changes). */
  planActive: boolean;
  /** Set while FTech has the business suspended (I2); only routes using resolveTenantAllowSuspended see it. */
  suspendReason: string | null;
}

export interface AppVariables {
  db: Db;
  auth: Auth;
  env: Env;
  mailer: Mailer;
  push: PushSender;
  toyyibpay: ToyyibPayClient;
  /** null when S3_* is not configured. */
  storage: ObjectStorage | null;
  userId: number;
  session: AuthSession;
  tenant: Tenant;
  /** Set by requirePlatformAdmin on /admin routes. */
  admin: AdminMe;
}

export type AppEnv = { Variables: AppVariables };
