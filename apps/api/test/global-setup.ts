import { runMigrations } from '@outletbooking/db/migrate';
import { testDatabaseUrl } from './test-db-url';

export default async function setup() {
  await runMigrations(testDatabaseUrl());
}
