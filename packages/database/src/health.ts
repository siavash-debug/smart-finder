/**
 * Database readiness probe used by `/readyz` on both planes.
 */

import type { ComponentHealth } from "@smart-finder/shared";
import type { DatabasePool } from "./pool.js";

/** Above this, the database is reachable but slow enough to be worth surfacing. */
const DEGRADED_LATENCY_MS = 500;

/**
 * Probe messages are returned to unauthenticated callers on `/readyz`, so only the error
 * class is exposed — never the message, which for connection errors contains the host, port,
 * and sometimes the user from the connection string.
 */
export async function checkDatabaseHealth(
  pool: DatabasePool,
  options: { timeoutMs?: number } = {},
): Promise<ComponentHealth> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const startedAt = performance.now();

  try {
    await withTimeout(pool.query("SELECT 1"), timeoutMs);
    const latency = Math.round(performance.now() - startedAt);

    return latency > DEGRADED_LATENCY_MS
      ? { name: "database", status: "degraded", detail: "slow response", latency_ms: latency }
      : { name: "database", status: "ok", latency_ms: latency };
  } catch (error) {
    return {
      name: "database",
      status: "down",
      detail: error instanceof Error ? error.name : "unknown error",
      latency_ms: Math.round(performance.now() - startedAt),
    };
  }
}

class ProbeTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`probe exceeded ${String(timeoutMs)}ms`);
    this.name = "ProbeTimeoutError";
  }
}

/**
 * A pool with no free connections leaves `query` pending until `connectionTimeoutMillis`,
 * which can exceed a load balancer's probe budget. This bounds the probe independently.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new ProbeTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
