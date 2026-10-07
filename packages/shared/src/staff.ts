import { z } from 'zod';
import { emailSchema, passwordSchema, phoneE164 } from './schemas';

/** D12 permissions. Defaults: own bookings only, may take payments, may not change setup. */
const permissionFlags = {
  /** See every resource's bookings, not only their own. */
  canViewAll: z.boolean(),
  /** Record cash, DuitNow and card payments. */
  canTakePayments: z.boolean(),
  /** Services, prices and hours. */
  canEditSetup: z.boolean(),
};

/** Owner invites a staff member by email, optionally linking the resource that is "them". */
export const staffInviteSchema = z.object({
  email: emailSchema,
  resourceId: z.number().int().positive().nullable().default(null),
  canViewAll: permissionFlags.canViewAll.default(false),
  canTakePayments: permissionFlags.canTakePayments.default(true),
  canEditSetup: permissionFlags.canEditSetup.default(false),
});
export type StaffInviteInput = z.input<typeof staffInviteSchema>;
export type StaffInvite = z.infer<typeof staffInviteSchema>;

/** Owner changes a staff member's access. */
export const memberUpdateSchema = z.object({
  isActive: z.boolean().optional(),
  canViewAll: permissionFlags.canViewAll.optional(),
  canTakePayments: permissionFlags.canTakePayments.optional(),
  canEditSetup: permissionFlags.canEditSetup.optional(),
  /** Resources linked to this staff login (replaces the full list). */
  resourceIds: z.array(z.number().int().positive()).max(200).optional(),
});
export type MemberUpdate = z.infer<typeof memberUpdateSchema>;

/** Invitee without an account creates one while accepting. */
export const acceptInviteNewAccountSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(100),
  phone: phoneE164,
  password: passwordSchema,
});
export type AcceptInviteNewAccount = z.infer<typeof acceptInviteNewAccountSchema>;

/** Body is empty when the invitee is already logged in with the invited email. */
export const acceptInviteSchema = z.union([acceptInviteNewAccountSchema, z.object({}).strict()]);

export const inviteTokenParam = z.object({ token: z.string().regex(/^[a-f0-9]{48}$/, 'Invalid invitation link') });

export interface StaffMember {
  memberId: number;
  userId: number;
  name: string;
  email: string;
  phone: string | null;
  role: 'owner' | 'staff';
  isActive: boolean;
  canViewAll: boolean;
  canTakePayments: boolean;
  canEditSetup: boolean;
  resources: { id: number; name: string }[];
}

export interface StaffInvitation {
  id: number;
  email: string;
  resourceId: number | null;
  canViewAll: boolean;
  canTakePayments: boolean;
  canEditSetup: boolean;
  expiresAt: string; // ISO
  inviteUrl: string;
}

export interface StaffListResponse {
  members: StaffMember[];
  invitations: StaffInvitation[];
}

/** Public view of an invitation (by token). */
export interface InvitationInfo {
  businessName: string;
  email: string;
  resourceName: string | null;
  status: 'pending' | 'expired' | 'accepted';
  /** True when the invited email already has a login → log in, then accept. */
  accountExists: boolean;
}
