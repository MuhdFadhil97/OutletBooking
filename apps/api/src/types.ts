import type { Db } from '@outletbooking/db';
import type { MemberRole } from '@outletbooking/shared';
import type { Auth, AuthSession } from './auth';
import type { Env } from './env';

/** Resolved from business_members on every authenticated request — never from the client. */
export interface Tenant {
  businessId: number;
  memberId: number;
  role: MemberRole;
  canViewAll: boolean;
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
