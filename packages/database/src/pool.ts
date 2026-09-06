/**
 * PostgreSQL connection pool.
 *
 * No ORM: the deduplication and match fan-out queries are the performance-critical paths and
 * are written as explicit, indexed SQL (ARCHITECTURE §9). This module owns pool lifecycle and
 * the type parsers that keep money exact.
 */

import pg from "pg";
import type { DatabaseEnv, Logger } from "@smart-finder/shared";

const { Pool, types } = pg;

export type DatabasePool = pg.Pool;
export type DatabaseClient = pg.PoolClient;

const PG_OID_INT8 = 20;
const PG_OID_NUMERIC = 1700;

let typeParsersInstalled = false;

/**
 * Money is BIGINT Toman (ADR-0005). The driver returns `int8` as a string to avoid silent
 * precision loss in `number`; we convert to `bigint` instead, which is exact and is what the
 * domain types expect. `numeric` is deliberately left as a string — it has no lossless
 * JavaScript counterpart, and no column in this schema needs it as a number.
 *
 * Type parsers are process-global in `pg`, so this runs exactly once.
 */
export function installTypeParsers(): void {
  if (typeParsersInstalled) return;
  types.setTypeParser(PG_OID_INT8, (value: string) => BigInt(value));
  types.setTypeParser(PG_OID_NUMERIC, (value: string) => value);
  typeParsersInstalled = true;
}

export interface CreatePoolOptions {
  env: DatabaseEnv;
  logger?: Logger;
  /** Identifies this process in `pg_stat_activity`, which makes lock debugging tractable. */
  applicationName?: string;
}

export function createPool(options: CreatePoolOptions): DatabasePool {
  installTypeParsers();

  const { env, logger, applicationName = "smart-finder" } = options;

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    idleTimeoutMillis: env.DATABASE_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.DATABASE_CONNECTION_TIMEOUT_MS,
    application_name: applicationName,
    ...(env.DATABASE_SSL ? { ssl: { rejectUnauthorized: true } } : {}),
  });

  // An idle client that errors (server restart, network drop) emits on the pool. Without a
  // listener this is an unhandled 'error' event and crashes the process.
  pool.on("error", (error) => {
    logger?.error("database pool client error", {
      err: error,
      error_type: "pool_client_error",
    });
  });

  return pool;
}

export async function closePool(pool: DatabasePool): Promise<void> {
  await pool.end();
}

/**
 * Runs `fn` inside a transaction, committing on success and rolling back on any throw.
 * The client is always released, including when the rollback itself fails.
 */
export async function withTransaction<T>(
  pool: DatabasePool,
  fn: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The transaction is already lost; surface the original failure instead.
    }
    throw error;
  } finally {
    client.release();
  }
}
