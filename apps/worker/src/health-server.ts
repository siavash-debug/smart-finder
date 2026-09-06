/**
 * Minimal HTTP surface for the worker.
 *
 * The worker is not a web service; this exists only so a container orchestrator has liveness
 * and readiness probes (ADR-0010). It exposes nothing else — no job control, no data.
 */

import { createServer, type Server } from "node:http";

import {
  aggregateReadiness,
  buildLiveness,
  readinessHttpStatus,
  type ComponentHealth,
  type Logger,
} from "@smart-finder/shared";

export interface HealthServerOptions {
  port: number;
  version: string;
  logger: Logger;
  /** Dependency probes run on every `/readyz` request. */
  probes: () => Promise<ComponentHealth[]>;
}

export interface HealthServer {
  close: () => Promise<void>;
}

export async function startHealthServer(options: HealthServerOptions): Promise<HealthServer> {
  const { port, version, logger, probes } = options;
  const startedAt = Date.now();

  const server: Server = createServer((req, res) => {
    const url = req.url ?? "/";
    const path = url.split("?")[0];

    const send = (status: number, body: unknown): void => {
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(body));
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      send(405, { error: "method_not_allowed" });
      return;
    }

    if (path === "/healthz") {
      send(
        200,
        buildLiveness({
          service: "worker",
          version,
          uptimeSeconds: (Date.now() - startedAt) / 1000,
        }),
      );
      return;
    }

    if (path === "/readyz") {
      probes()
        .then((components) => {
          const report = aggregateReadiness(components);
          send(readinessHttpStatus(report), report);
        })
        .catch((error: unknown) => {
          logger.error("readiness probe threw", {
            err: error,
            error_type: "readiness_probe_failed",
          });
          send(503, {
            status: "not_ready",
            checked_at: new Date().toISOString(),
            components: [{ name: "probe", status: "down", detail: "probe error" }],
          });
        });
      return;
    }

    send(404, { error: "not_found" });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  logger.info("health server listening", { port, status: "listening" });

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        // Probe connections are keep-alive; without this, close() waits for them to idle out.
        server.closeIdleConnections();
      }),
  };
}
