import "server-only";

import { createPool, type DatabasePool } from "@smart-finder/database";
import { loadDatabaseEnv } from "@smart-finder/shared";

import { logger } from "./logger";

/**
 * One pool per process, reused across requests.
 *
 * In development Next.js re-evaluates modules on every hot reload; without this global cache
 * each reload would leak a pool and exhaust `max_connections` within minutes.
 */
const globalForPool = globalThis as typeof globalThis & {
  __smartFinderPool?: DatabasePool;
};

export function getPool(): DatabasePool {
  globalForPool.__smartFinderPool ??= createPool({
    env: loadDatabaseEnv(),
    logger,
    applicationName: "smart-finder-web",
  });
  return globalForPool.__smartFinderPool;
}
