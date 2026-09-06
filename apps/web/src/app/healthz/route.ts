import { buildLiveness } from "@smart-finder/shared";

import { WEB_VERSION } from "@/lib/version";

/**
 * Liveness probe. Touches no dependency and never fails while the process can serve, so an
 * orchestrator does not restart healthy web instances when the database blips (ADR-0010).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const body = buildLiveness({
    service: "web",
    version: WEB_VERSION,
    uptimeSeconds: process.uptime(),
  });

  return Response.json(body, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
