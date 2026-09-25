import { execSync } from 'node:child_process';

/**
 * Brings the test database up to the latest migration before the suite runs.
 *
 * Deliberately non-destructive (`migrate deploy`, never `reset`): tests isolate
 * themselves by creating uniquely named data instead of wiping tables. That's
 * also the only approach compatible with the audit log, which the database
 * refuses to delete from.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see apps/api/.env.example)');
  // Safety net: tests write data, so never point them at a non-test database.
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error(`TEST_DATABASE_URL must point at a database whose name contains "test" (got ${url})`);
  }
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: url } });
}
