import type { Db } from '@outletbooking/db';
import type { MemberRole } from '@outletbooking/shared';
import type { Auth, AuthSession } from './auth';
import type { Env } from './env';

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
}

export interface AppVariables {
  db: Db;
  auth: Auth;
  env: Env;
  userId: number;
  session: AuthSession;
  tenant: Tenant;
}

export type AppEnv = { Variables: AppVariables };
