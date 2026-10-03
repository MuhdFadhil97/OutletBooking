import { assertLocalDatabase, loadApiEnv, requireDatabaseUrl } from './env';
import { runMigrations } from './migrate';

loadApiEnv();
const url = requireDatabaseUrl();
assertLocalDatabase(url);

console.log(`Applying migrations to ${new URL(url).host}${new URL(url).pathname} ...`);
await runMigrations(url);
console.log('Migrations applied.');
