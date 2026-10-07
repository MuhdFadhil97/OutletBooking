import { Hono } from 'hono';
import {
  copyWorkingHoursSchema,
  idParam,
  resourceCreateSchema,
  resourceUpdateSchema,
  workingHoursSchema,
} from '@outletbooking/shared';
import { requireSession } from '../middleware/session';
import { requirePermission, requireRole, resolveTenant } from '../middleware/tenant';
import {
  archiveResource,
  createResource,
  getResource,
  listResources,
  resourceScope,
  updateResource,
} from '../services/resources';
import { copyWorkingHours, getWorkingHours, setWorkingHours } from '../services/working-hours';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/**
 * Read: owner, or staff limited to their linked resources.
 * Create / edit / archive (plan limit, staff links): owner. Working hours: owner, or staff with "can change setup".
 */
export const resourceRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant)
  .get('/', async (c) =>
    c.json(await listResources(c.var.db, c.var.tenant.businessId, resourceScope(c.var.tenant, c.var.userId))),
  )
  .get('/:id', validate('param', idParam), async (c) =>
    c.json(
      await getResource(
        c.var.db,
        c.var.tenant.businessId,
        c.req.valid('param').id,
        resourceScope(c.var.tenant, c.var.userId),
      ),
    ),
  )
  .post('/', requireRole('owner'), validate('json', resourceCreateSchema), async (c) =>
    c.json(await createResource(c.var.db, c.var.tenant.businessId, c.req.valid('json')), 201),
  )
  .patch('/:id', requireRole('owner'), validate('param', idParam), validate('json', resourceUpdateSchema), async (c) =>
    c.json(await updateResource(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .delete('/:id', requireRole('owner'), validate('param', idParam), async (c) => {
    await archiveResource(c.var.db, c.var.tenant.businessId, c.req.valid('param').id);
    return c.body(null, 204);
  })
  .get('/:id/working-hours', validate('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    // Same visibility rule as the resource itself.
    await getResource(c.var.db, c.var.tenant.businessId, id, resourceScope(c.var.tenant, c.var.userId));
    return c.json(await getWorkingHours(c.var.db, c.var.tenant.businessId, id));
  })
  .put(
    '/:id/working-hours',
    requirePermission('canEditSetup'),
    validate('param', idParam),
    validate('json', workingHoursSchema),
    async (c) =>
      c.json(
        await setWorkingHours(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, c.req.valid('json').hours),
      ),
  )
  .post(
    '/:id/working-hours/copy',
    requirePermission('canEditSetup'),
    validate('param', idParam),
    validate('json', copyWorkingHoursSchema),
    async (c) => {
      await copyWorkingHours(
        c.var.db,
        c.var.tenant.businessId,
        c.req.valid('param').id,
        c.req.valid('json').toResourceIds,
      );
      return c.body(null, 204);
    },
  );
