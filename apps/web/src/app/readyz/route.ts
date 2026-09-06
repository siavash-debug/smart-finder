import { checkDatabaseHealth } from "@smart-finder/database";
import { aggregateReadiness, readinessHttpStatus } from "@smart-finder/shared";

import { getPool } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Readiness probe. Returns 503 when a required dependency is down so the instance is taken
 * out of rotation without being restarted (ADR-0010).
 *
 * Component detail is intentionally coarse — this endpoint is reachable without
 * authentication, and connection errors carry host, port and user in their messages.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let components;
  try {
    components = [await checkDatabaseHealth(getPool())];
  } catch (error) {
    // Reaching here means the pool could not even be constructed — typically invalid env.
    logger.error("readiness check failed", {
      err: error,
      error_type: "readiness_probe_failed",
    });
    components = [{ name: "database", status: "down" as const, detail: "unavailable" }];
  }

  const report = aggregateReadiness(components);

  return Response.json(report, {
    status: readinessHttpStatus(report),
    headers: { "cache-control": "no-store" },
  });
}
