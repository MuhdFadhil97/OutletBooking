import { TEMPLATE_INFO, type BusinessTemplate } from '@outletbooking/shared';
import type { Tx } from './client';
import { bookingFields, servicePriceRules, services } from './schema';

/**
 * Pre-fills a new business with its template's sample services, peak price
 * rules and booking fields. Run inside the sign-up transaction.
 */
export async function applyTemplate(tx: Tx, businessId: number, template: BusinessTemplate): Promise<void> {
  const info = TEMPLATE_INFO[template];

  for (const [i, { priceRules, ...service }] of info.services.entries()) {
    const [row] = await tx
      .insert(services)
      .values({ ...service, businessId, sortOrder: i })
      .returning({ id: services.id });
    if (!row) throw new Error('service insert returned no row');

    const rules = (priceRules ?? []).flatMap(({ weekdays, ...rule }) =>
      weekdays.map((weekday) => ({ ...rule, weekday, businessId, serviceId: row.id })),
    );
    if (rules.length) await tx.insert(servicePriceRules).values(rules);
  }

  if (info.bookingFields.length) {
    await tx
      .insert(bookingFields)
      .values(info.bookingFields.map((field, i) => ({ ...field, businessId, sortOrder: i })));
  }
}
