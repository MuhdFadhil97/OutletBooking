import { leads, type Db } from '@outletbooking/db';
import type { leadCreateSchema } from '@outletbooking/shared';
import type { z } from 'zod';

/** I19 website contact form. Consent is required by the schema; its time is saved with the lead. */
export async function createLead(db: Db, input: z.output<typeof leadCreateSchema>): Promise<void> {
  await db.insert(leads).values({
    reason: input.reason,
    name: input.name,
    businessName: input.businessName ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    businessType: input.businessType ?? null,
    resourceCount: input.resourceCount ?? null,
    message: input.message ?? null,
    consentAt: new Date(),
  });
}
