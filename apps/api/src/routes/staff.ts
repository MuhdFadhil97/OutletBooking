import { Hono } from 'hono';
import { idParam, memberUpdateSchema, staffInviteSchema } from '@outletbooking/shared';
import { requireSession } from '../middleware/session';
import { requireRole, requireActivePlan, requirePlanFeature, resolveTenant } from '../middleware/tenant';
import { inviteStaff, listStaff, revokeInvitation, updateMember } from '../services/staff';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/** Owner manages the team: members, pending invitations, access. Needs a plan with the staff app (Business). */
export const staffRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant, requireActivePlan, requireRole('owner'), requirePlanFeature('staff_app'))
  .get('/', async (c) => c.json(await listStaff(c.var.db, c.var.tenant.businessId, c.var.env.APP_PUBLIC_URL)))
  .post('/invitations', validate('json', staffInviteSchema), async (c) =>
    c.json(
      await inviteStaff(c.var.db, c.var.tenant.businessId, c.var.userId, c.req.valid('json'), c.var.env.APP_PUBLIC_URL, {
        mailer: c.var.mailer,
        websiteUrl: c.var.env.WEBSITE_URL,
      }),
      201,
    ),
  )
  .delete('/invitations/:id', validate('param', idParam), async (c) => {
    await revokeInvitation(c.var.db, c.var.tenant.businessId, c.req.valid('param').id);
    return c.body(null, 204);
  })
  .patch('/:id', validate('param', idParam), validate('json', memberUpdateSchema), async (c) =>
    c.json(
      await updateMember(
        c.var.db,
        c.var.tenant.businessId,
        c.req.valid('param').id,
        c.req.valid('json'),
        c.var.env.APP_PUBLIC_URL,
      ),
    ),
  );
