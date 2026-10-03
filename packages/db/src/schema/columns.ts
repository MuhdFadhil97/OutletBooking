import { customType, integer, timestamp } from 'drizzle-orm/pg-core';

/** Case-insensitive text (extension `citext`). */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

/** integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY */
export const idPk = () => integer('id').primaryKey().generatedAlwaysAsIdentity();

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Kept current by the set_updated_at() trigger (custom migration). */
export const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
