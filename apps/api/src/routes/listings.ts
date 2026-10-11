import { Hono } from 'hono';
import { idParam, listingCreateSchema, listingQuery, listingUpdateSchema } from '@outletbooking/shared';
import { requireSession } from '../middleware/session';
import { requirePermission, requireActivePlan, resolveTenant } from '../middleware/tenant';
import { archiveListing, createListing, getListing, listListings, updateListing } from '../services/listings';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/** ST-RE-L listings. Read: any member. Write: owner, or staff with "can change setup". */
export const listingRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant, requireActivePlan)
  .get('/', validate('query', listingQuery), async (c) =>
    c.json(await listListings(c.var.db, c.var.tenant.businessId, c.req.valid('query'))),
  )
  .get('/:id', validate('param', idParam), async (c) =>
    c.json(await getListing(c.var.db, c.var.tenant.businessId, c.req.valid('param').id)),
  )
  .post('/', requirePermission('canEditSetup'), validate('json', listingCreateSchema), async (c) =>
    c.json(await createListing(c.var.db, c.var.tenant.businessId, c.req.valid('json')), 201),
  )
  .patch('/:id', requirePermission('canEditSetup'), validate('param', idParam), validate('json', listingUpdateSchema), async (c) =>
    c.json(await updateListing(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .delete('/:id', requirePermission('canEditSetup'), validate('param', idParam), async (c) => {
    await archiveListing(c.var.db, c.var.tenant.businessId, c.req.valid('param').id);
    return c.body(null, 204);
  });
