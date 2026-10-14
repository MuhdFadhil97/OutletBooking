import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // Workspace package is plain TypeScript source.
  transpilePackages: ['@outletbooking/shared'],
  // Monorepo: trace files from the repo root (legal pages read docs/legal at build time).
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  poweredByHeader: false,
};

export default config;
