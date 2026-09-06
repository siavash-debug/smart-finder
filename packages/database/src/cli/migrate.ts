/**
 * CLI entry point: `npm run db:migrate`.
 *
 * Applies every pending migration, then exits. Intended to run as a deploy step or manually
 * in development — never automatically at web/worker startup, where two instances racing to
 * migrate is a common source of production incidents.
 */

import { createLogger, loadDatabaseEnv } from "@smart-finder/shared";

import { migrate } from "../migrate.js";
import { closePool, createPool } from "../pool.js";

async function main(): Promise<void> {
  const env = loadDatabaseEnv();
  const logger = createLogger({ level: "info", base: { service: "migrate" } });
  const pool = createPool({ env, logger, applicationName: "smart-finder-migrate" });

  try {
    const result = await migrate({ pool, logger });
    logger.info("migrations complete", {
      status: "completed",
      applied_count: result.applied.length,
      skipped_count: result.skipped.length,
    });
  } finally {
    await closePool(pool);
  }
}

main().catch((error: unknown) => {
  const logger = createLogger({ level: "error", base: { service: "migrate" } });
  logger.fatal("migrations failed", { err: error, error_type: "migration_failed" });
  process.exitCode = 1;
});
