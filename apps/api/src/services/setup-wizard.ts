import { and, asc, count, countDistinct, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  bookingFields,
  businesses,
  businessMembers,
  resources,
  resourceServices,
  servicePriceRules,
  services,
  subscriptions,
  workingHours,
  type Db,
  type Tx,
} from '@outletbooking/db';
import {
  TEMPLATE_INFO,
  applyPaymentRule,
  businessPaymentRule,
  type BusinessTemplate,
  type OnboardingSetup,
  type PaymentRule,
  type SetupSummary,
} from '@outletbooking/shared';
import { AppError, notFound } from '../errors';

type Q = Db | Tx;

async function loadBusiness(q: Q, businessId: number) {
  const [biz] = await q
    .select({
      template: businesses.template,
      resourceLabel: businesses.resourceLabel,
      minAdvanceMin: businesses.minAdvanceMin,
      maxDaysAhead: businesses.maxDaysAhead,
      cancelCutoffMin: businesses.cancelCutoffMin,
      customersCanCancel: businesses.customersCanCancel,
      settings: businesses.settings,
    })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), isNull(businesses.deletedAt)));
  if (!biz) throw notFound('Business');
  return { ...biz, template: biz.template as BusinessTemplate };
}

const activeServices = (q: Q, businessId: number) =>
  q
    .select({
      id: services.id,
      priceSen: services.priceSen,
      depositSen: services.depositSen,
      prepayFull: services.prepayFull,
      priceUnit: services.priceUnit,
      durationMin: services.durationMin,
      durationOptions: services.durationOptions,
      bufferMin: services.bufferMin,
      travelBufferMin: services.travelBufferMin,
      locationType: services.locationType,
      isVisible: services.isVisible,
    })
    .from(services)
    .where(and(eq(services.businessId, businessId), isNull(services.deletedAt)))
    .orderBy(asc(services.sortOrder), asc(services.id));

type ServiceRow = Awaited<ReturnType<typeof activeServices>>[number];
const asPayment = (s: ServiceRow) => ({ ...s, priceUnit: s.priceUnit as 'per_booking' | 'per_block' });

/** ST · Setup tab: everything the template-driven rows summarise, in one call. */
export async function getSetupSummary(db: Db, businessId: number): Promise<SetupSummary> {
  const biz = await loadBusiness(db, businessId);
  const [svcRows, resRows, hourRows, [peak], fieldRows, [staff]] = await Promise.all([
    activeServices(db, businessId),
    db
      .select({ id: resources.id, userId: resources.userId })
      .from(resources)
      .where(and(eq(resources.businessId, businessId), isNull(resources.deletedAt), eq(resources.isActive, true))),
    db
      .select({
        resourceId: workingHours.resourceId,
        weekday: workingHours.weekday,
        startTime: workingHours.startTime,
        endTime: workingHours.endTime,
      })
      .from(workingHours)
      .innerJoin(resources, and(eq(resources.businessId, workingHours.businessId), eq(resources.id, workingHours.resourceId)))
      .where(and(eq(workingHours.businessId, businessId), isNull(resources.deletedAt), eq(resources.isActive, true)))
      .orderBy(asc(workingHours.weekday), asc(workingHours.startTime)),
    db
      .select({ n: countDistinct(servicePriceRules.serviceId) })
      .from(servicePriceRules)
      .innerJoin(services, and(eq(services.businessId, servicePriceRules.businessId), eq(services.id, servicePriceRules.serviceId)))
      .where(and(eq(servicePriceRules.businessId, businessId), isNull(services.deletedAt))),
    db
      .select({ label: bookingFields.label })
      .from(bookingFields)
      .where(and(eq(bookingFields.businessId, businessId), eq(bookingFields.isActive, true)))
      .orderBy(asc(bookingFields.sortOrder), asc(bookingFields.id)),
    db
      .select({ n: count() })
      .from(businessMembers)
      .where(
        and(eq(businessMembers.businessId, businessId), eq(businessMembers.role, 'staff'), eq(businessMembers.isActive, true)),
      ),
  ]);

  // Hours shared by every resource → show them; different per resource → "varies".
  const fmt = (t: string) => t.slice(0, 5);
  const byResource = new Map<number, string>();
  for (const r of resRows) {
    const sig = hourRows
      .filter((h) => h.resourceId === r.id)
      .map((h) => `${h.weekday}-${fmt(h.startTime)}-${fmt(h.endTime)}`)
      .join('|');
    byResource.set(r.id, sig);
  }
  const signatures = new Set(byResource.values());
  const hoursVary = signatures.size > 1;
  const first = resRows[0];
  const hours =
    !hoursVary && first
      ? hourRows
          .filter((h) => h.resourceId === first.id)
          .map((h) => ({ weekday: h.weekday, startTime: fmt(h.startTime), endTime: fmt(h.endTime) }))
      : [];

  const prices = svcRows.map((s) => s.priceSen);
  const mobile = svcRows.find((s) => s.locationType === 'at_customer_location');
  return {
    template: biz.template,
    resourceLabel: biz.resourceLabel,
    resources: { count: resRows.length, linkedToStaff: resRows.filter((r) => r.userId !== null).length },
    services: {
      count: svcRows.length,
      minPriceSen: prices.length ? Math.min(...prices) : null,
      maxPriceSen: prices.length ? Math.max(...prices) : null,
      durationOptions: [...new Set(svcRows.flatMap((s) => s.durationOptions ?? []))].sort((a, b) => a - b),
      maxBufferMin: Math.max(0, ...svcRows.map((s) => s.bufferMin)),
      maxTravelBufferMin: Math.max(0, ...svcRows.map((s) => s.travelBufferMin)),
      peakServiceCount: peak?.n ?? 0,
    },
    hours,
    hoursVary,
    paymentRule: businessPaymentRule(svcRows.map(asPayment)),
    maxDepositSen: Math.max(0, ...svcRows.map((s) => s.depositSen)),
    bookingFields: fieldRows.map((f) => f.label),
    staffCount: staff?.n ?? 0,
    rules: {
      minAdvanceMin: biz.minAdvanceMin,
      maxDaysAhead: biz.maxDaysAhead,
      cancelCutoffMin: biz.cancelCutoffMin,
      customersCanCancel: biz.customersCanCancel,
    },
    mobileServiceVisible: mobile ? mobile.isVisible : null,
    settings: biz.settings,
  };
}

/** Puts every (non-archived) service on one payment rule. */
async function applyRuleToAll(tx: Tx, businessId: number, rule: PaymentRule, defaultDepositSen: number) {
  for (const svc of await activeServices(tx, businessId)) {
    const patch = applyPaymentRule(asPayment(svc), rule, defaultDepositSen);
    await tx.update(services).set(patch).where(and(eq(services.businessId, businessId), eq(services.id, svc.id)));
  }
}

/** Setup "Payment to confirm": one rule for all services. */
export async function setPaymentRule(db: Db, businessId: number, rule: PaymentRule): Promise<SetupSummary> {
  await db.transaction(async (tx) => {
    const biz = await loadBusiness(tx, businessId);
    await applyRuleToAll(tx, businessId, rule, TEMPLATE_INFO[biz.template].defaultDepositSen);
  });
  return getSetupSummary(db, businessId);
}

/**
 * O1c · sign-up step 3 "Finish", in one transaction: resource label, resources (+ owner link),
 * the same weekly hours for each, service edits, an optional first service, the payment rule,
 * travel time, template settings, and every resource linked to every service.
 * Only for a business without resources yet, so a double tap can't create duplicates.
 */
export async function finishOnboarding(db: Db, businessId: number, ownerUserId: number, input: OnboardingSetup): Promise<SetupSummary> {
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ template: businesses.template })
      .from(businesses)
      .where(and(eq(businesses.id, businessId), isNull(businesses.deletedAt)))
      .for('update');
    if (!locked) throw notFound('Business');
    const template = TEMPLATE_INFO[locked.template as BusinessTemplate];

    const [existing] = await tx
      .select({ n: count() })
      .from(resources)
      .where(and(eq(resources.businessId, businessId), isNull(resources.deletedAt)));
    if ((existing?.n ?? 0) > 0) {
      throw new AppError(409, 'already_set_up', 'Your business is already set up. Change it in Setup.');
    }
    const [sub] = await tx
      .select({ limit: subscriptions.resourceLimit })
      .from(subscriptions)
      .where(eq(subscriptions.businessId, businessId));
    const limit = sub?.limit ?? 10;
    if (input.resources.length > limit) {
      throw new AppError(409, 'resource_limit', `Your plan allows up to ${limit} resources`);
    }

    if (input.resourceLabel || input.settings) {
      await tx
        .update(businesses)
        .set({
          ...(input.resourceLabel ? { resourceLabel: input.resourceLabel } : {}),
          // Shallow merge, same as PATCH /businesses/current.
          ...(input.settings ? { settings: sql`${businesses.settings} || ${JSON.stringify(input.settings)}::jsonb` } : {}),
        })
        .where(eq(businesses.id, businessId));
    }

    const created = await tx
      .insert(resources)
      .values(
        input.resources.map((r, i) => ({
          businessId,
          name: r.name,
          resourceType: template.resourceType,
          userId: r.isMe ? ownerUserId : null,
          sortOrder: i,
        })),
      )
      .returning({ id: resources.id });
    const resourceIds = created.map((r) => r.id);
    if (input.hours.length) {
      await tx.insert(workingHours).values(resourceIds.flatMap((resourceId) => input.hours.map((h) => ({ ...h, businessId, resourceId }))));
    }

    const current = await activeServices(tx, businessId);
    const byId = new Map(current.map((s) => [s.id, s]));
    for (const edit of input.services) {
      const svc = byId.get(edit.id);
      if (!svc) throw notFound('Service');
      // Services with customer-chosen lengths keep their base duration (options are multiples of it).
      const durationMin = svc.durationOptions?.length ? undefined : edit.durationMin;
      const patch = {
        ...(edit.priceSen !== undefined ? { priceSen: edit.priceSen } : {}),
        ...(durationMin !== undefined ? { durationMin } : {}),
        ...(edit.isVisible !== undefined ? { isVisible: edit.isVisible } : {}),
      };
      if (Object.keys(patch).length) {
        await tx.update(services).set(patch).where(and(eq(services.businessId, businessId), eq(services.id, edit.id)));
      }
    }
    if (input.newService) {
      await tx.insert(services).values({ ...input.newService, businessId, sortOrder: current.length });
    }
    if (input.travelBufferMin !== undefined) {
      await tx
        .update(services)
        .set({ travelBufferMin: input.travelBufferMin })
        .where(
          and(eq(services.businessId, businessId), eq(services.locationType, 'at_customer_location'), isNull(services.deletedAt)),
        );
    }

    // After price edits, so a deposit is capped by the new price.
    await applyRuleToAll(tx, businessId, input.paymentRule, template.defaultDepositSen);

    const serviceIds = (await activeServices(tx, businessId)).map((s) => s.id);
    if (serviceIds.length) {
      await tx
        .insert(resourceServices)
        .values(serviceIds.flatMap((serviceId) => resourceIds.map((resourceId) => ({ businessId, serviceId, resourceId }))));
    }
    // A deposit higher than an edited price would fail the service CHECK later — catch it here clearly.
    const bad = await tx
      .select({ id: services.id })
      .from(services)
      .where(
        and(
          eq(services.businessId, businessId),
          inArray(services.id, serviceIds.length ? serviceIds : [0]),
          sql`${services.priceUnit} <> 'per_block' AND ${services.depositSen} > ${services.priceSen}`,
        ),
      );
    if (bad.length) throw new AppError(400, 'validation_error', 'Deposit cannot be more than the price');
  });
  return getSetupSummary(db, businessId);
}
