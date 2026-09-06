/**
 * Forward-only SQL migration runner.
 *
 * Migrations are plain `.sql` files named `NNNN_description.sql`, applied in filename order.
 * Each runs inside its own transaction, and the whole run holds a session-level advisory lock
 * so two processes starting at once cannot apply the same migration twice.
 *
 * Applied migrations are checksummed. Editing a file that has already run is a mistake that
 * silently desynchronises environments, so it is reported as an error rather than ignored.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Logger } from "@smart-finder/shared";
import type { DatabaseClient, DatabasePool } from "./pool.js";

/** Arbitrary but fixed key; any process migrating this database must use the same value. */
const MIGRATION_ADVISORY_LOCK_KEY = 8_215_140_073_001n;

const MIGRATION_FILENAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface Migration {
  version: string;
  name: string;
  filename: string;
  sql: string;
  checksum: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export class MigrationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MigrationError";
  }
}

/** `migrations/` sits at the package root, one level above both `src/` and `dist/`. */
export function defaultMigrationsDir(): string {
  return fileURLToPath(new URL("../migrations/", import.meta.url));
}

/**
 * Pure filename parser. Enforces the `NNNN_snake_case.sql` convention so ordering is
 * lexicographic and unambiguous — `10_x.sql` sorting before `9_x.sql` is a classic way to
 * apply migrations out of order.
 */
export function parseMigrationFilename(filename: string): { version: string; name: string } {
  const match = MIGRATION_FILENAME.exec(filename);
  if (match === null) {
    throw new MigrationError(
      `Invalid migration filename "${filename}". Expected NNNN_snake_case_name.sql`,
    );
  }
  return { version: match[1]!, name: match[2]! };
}

export function checksum(sql: string): string {
  // Normalise line endings so a Windows checkout does not produce a different checksum.
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

export async function loadMigrations(dir: string = defaultMigrationsDir()): Promise<Migration[]> {
  const entries = await readdir(dir);
  const sqlFiles = entries.filter((entry) => entry.endsWith(".sql")).sort();

  const migrations: Migration[] = [];
  const seen = new Set<string>();

  for (const filename of sqlFiles) {
    const { version, name } = parseMigrationFilename(filename);
    if (seen.has(version)) {
      throw new MigrationError(`Duplicate migration version ${version} in ${dir}`);
    }
    seen.add(version);

    const sql = await readFile(path.join(dir, filename), "utf8");
    migrations.push({ version, name, filename, sql, checksum: checksum(sql) });
  }

  return migrations;
}

const CREATE_TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migration (
    version     text        PRIMARY KEY,
    name        text        NOT NULL,
    checksum    text        NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    duration_ms integer     NOT NULL
  )
`;

interface AppliedRow {
  version: string;
  checksum: string;
}

export interface MigrateOptions {
  pool: DatabasePool;
  logger?: Logger;
  dir?: string;
}

export async function migrate(options: MigrateOptions): Promise<MigrationResult> {
  const { pool, logger } = options;
  const migrations = await loadMigrations(options.dir);

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [
      MIGRATION_ADVISORY_LOCK_KEY.toString(),
    ]);
    return await runMigrations(client, migrations, logger);
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1::bigint)", [
        MIGRATION_ADVISORY_LOCK_KEY.toString(),
      ]);
    } catch {
      // Releasing the session also releases the lock; nothing further to do.
    }
    client.release();
  }
}

async function runMigrations(
  client: DatabaseClient,
  migrations: Migration[],
  logger?: Logger,
): Promise<MigrationResult> {
  await client.query(CREATE_TRACKING_TABLE);

  const { rows } = await client.query<AppliedRow>("SELECT version, checksum FROM schema_migration");
  const applied = new Map(rows.map((row) => [row.version, row.checksum]));

  const result: MigrationResult = { applied: [], skipped: [] };

  for (const migration of migrations) {
    const previousChecksum = applied.get(migration.version);

    if (previousChecksum !== undefined) {
      if (previousChecksum !== migration.checksum) {
        throw new MigrationError(
          `Migration ${migration.filename} was modified after it was applied. ` +
            `Applied checksum ${previousChecksum}, file checksum ${migration.checksum}. ` +
            `Add a new migration instead of editing an applied one.`,
        );
      }
      result.skipped.push(migration.version);
      continue;
    }

    const startedAt = performance.now();
    try {
      await client.query("BEGIN");
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO schema_migration (version, name, checksum, duration_ms)
         VALUES ($1, $2, $3, $4)`,
        [
          migration.version,
          migration.name,
          migration.checksum,
          Math.round(performance.now() - startedAt),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw new MigrationError(`Migration ${migration.filename} failed`, { cause: error });
    }

    result.applied.push(migration.version);
    logger?.info("migration applied", {
      status: "applied",
      version: migration.version,
      name: migration.name,
      duration_ms: Math.round(performance.now() - startedAt),
    });
  }

  return result;
}
