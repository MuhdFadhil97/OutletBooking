import { defineConfig } from 'drizzle-kit';
import { loadApiEnv } from './src/env';

loadApiEnv();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://outlet:outlet@localhost:5432/outletbooking',
  },
  strict: true,
  verbose: true,
});
