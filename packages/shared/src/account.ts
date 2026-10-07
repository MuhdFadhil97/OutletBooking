import { z } from 'zod';
import { emailSchema, passwordSchema } from './schemas';

// ------------------------------------------------------------ password (E1, E2, H6)

/** E1 · Forgot password */
export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** Random token from the reset email (Better Auth generates 24 chars). */
export const resetTokenSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{16,128}$/, 'Invalid reset link');

/** E2 · Set new password (API body) */
export const resetPasswordSchema = z.object({
  token: resetTokenSchema,
  newPassword: passwordSchema,
  /** Sign out every device that is logged in with the old password. */
  logoutOtherDevices: z.boolean().default(true),
});
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;

/** E2 form: new password typed twice. */
export const resetPasswordFormSchema = z
  .object({ newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });
export type ResetPasswordForm = z.infer<typeof resetPasswordFormSchema>;

/** GET /password/reset/:token — who the link is for ("For owner@…"). */
export interface ResetTokenInfo {
  email: string;
}

/** H6 · Change password form */
export const changePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'Choose a different password',
    path: ['newPassword'],
  });
export type ChangePasswordForm = z.infer<typeof changePasswordFormSchema>;

// ------------------------------------------------------------ D8 setup checklist

export const SETUP_STEPS = ['account', 'resources', 'payments', 'shareLink', 'testBooking'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** D8 · First-time Today checklist. Worked out by the API from real data. */
export interface SetupChecklist {
  steps: { key: SetupStep; done: boolean }[];
  doneCount: number;
  total: number;
  /** Bookable resources with working hours (subtitle of step 2). */
  resourceCount: number;
  /** Every step done, or the owner chose "Hide". */
  hidden: boolean;
}

/** POST /businesses/current/checklist — things only the app knows about. */
export const checklistUpdateSchema = z
  .object({
    /** The owner shared the booking link (Share sheet opened). */
    linkShared: z.literal(true).optional(),
    /** The owner hid the checklist on Today. */
    hide: z.literal(true).optional(),
  })
  .refine((v) => v.linkShared || v.hide, { message: 'Nothing to update' });
export type ChecklistUpdate = z.infer<typeof checklistUpdateSchema>;
