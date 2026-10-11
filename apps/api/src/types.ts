import type { Db } from '@outletbooking/db';
import type { MemberRole } from '@outletbooking/shared';
import type { Auth, AuthSession } from './auth';
import type { Env } from './env';
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
}

export interface AppVariables {
  db: Db;
  auth: Auth;
  env: Env;
  push: PushSender;
  toyyibpay: ToyyibPayClient;
  /** null when S3_* is not configured. */
  storage: ObjectStorage | null;
  userId: number;
  session: AuthSession;
  tenant: Tenant;
}

export type AppEnv = { Variables: AppVariables };
