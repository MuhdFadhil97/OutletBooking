import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Tests share one real Postgres database — run files one at a time.
    fileParallelism: false,
    // Resetting the shared database (TRUNCATE ... CASCADE over ~50 tables) takes about 6 s on Docker Desktop for Windows,
    // and some files reset before every test, so 20 s was too tight when the machine is busy.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
