/**
 * Shared support for integration tests that need a real PostgreSQL instance.
 *
 * Not part of the published package (excluded from `tsconfig.build.json`) — this exists only
 * for `*.test.ts` files in this repository to import.
 *
 * Cleanup is explicit rather than transaction-rollback-per-test: `replaceActiveSearchProfile`
 * opens its own transaction internally (it needs a real `Pool`, not a client already inside
 * one — Postgres has no true nested transactions), so a test cannot simply wrap every call in
 * one outer `BEGIN ... ROLLBACK` and expect it to compose. Instead, every table that matters
 * here cascades from `app_user`, so a test creates its own user and deletes it afterward;
 * `ON DELETE CASCADE` takes care of everything hung off it.
 */

import pg from "pg";

import { installTypeParsers } from "../pool.js";

/**
 * Falls back to the same local Postgres `docker-compose.yml` brings up, so `npm test` works
 * out of the box after `npm run db:up` without any extra configuration. CI can point
 * `TEST_DATABASE_URL` at a disposable instance instead.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://smartfinder:smartfinder@localhost:5432/smartfinder";

let pool: pg.Pool | undefined;

export function getTestPool(): pg.Pool {
  installTypeParsers();
  pool ??= new pg.Pool({
    connectionString: TEST_DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 2_000,
  });
  return pool;
}

let availability: Promise<boolean> | undefined;

/**
 * Probes the test database once per test run and caches the result. Integration test files
 * call this in a `beforeAll` and skip themselves when it resolves `false`, so the suite still
 * passes in an environment with no Postgres reachable — it just skips what it cannot verify,
 * rather than failing or silently reporting success for something never actually run.
 */
export function isTestDatabaseAvailable(): Promise<boolean> {
  availability ??= getTestPool()
    .query("SELECT 1")
    .then(() => true)
    .catch(() => false);
  return availability;
}

/** Deletes a test user; `ON DELETE CASCADE` removes every row that hangs off it. */
export async function deleteTestUser(userId: string): Promise<void> {
  await getTestPool().query("DELETE FROM app_user WHERE id = $1", [userId]);
}

/** Deletes test jobs by `job_type`, for suites that enqueue jobs under a unique test type. */
export async function deleteTestJobsByType(jobType: string): Promise<void> {
  await getTestPool().query("DELETE FROM job WHERE job_type = $1", [jobType]);
}

/** A Telegram id unlikely to collide across concurrent test runs. */
export function randomTelegramUserId(): bigint {
  return BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
}

export async function closeTestPool(): Promise<void> {
  if (pool !== undefined) {
    await pool.end();
    pool = undefined;
  }
  availability = undefined;
}
