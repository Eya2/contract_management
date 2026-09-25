import 'dotenv/config';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export default defineConfig({
  test: {
    environment: 'node',
    // Tests never touch the dev database: DATABASE_URL is pointed at the test DB.
    env: {
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-0123456789',
      DATABASE_URL: testDatabaseUrl ?? 'postgresql://missing-TEST_DATABASE_URL',
      // Uploaded test files go to a throwaway directory, never ./storage.
      STORAGE_LOCAL_ROOT: path.join(tmpdir(), 'contract-hub-test-storage'),
    },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          // Files share one database; run them one after another.
          fileParallelism: false,
        },
      },
    ],
  },
});
