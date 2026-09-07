/**
 * Worker entry point — the ingest plane (ARCHITECTURE §5).
 *
 * A long-running process, not a request handler: it owns its own lifetime and must survive
 * transient dependency failures rather than exiting. Phase 0 wired the skeleton; Phase 1 wires
 * the poll loop to the real `job` table via `createJobPollTick`; Phase 4 registers the first
 * real handler, `send_telegram_notification`.
 *
 * A claimed job whose type has no registered handler fails loudly rather than being silently
 * dropped; see `job-dispatcher.ts`.
 */

import { checkDatabaseHealth, closePool, createPool } from "@smart-finder/database";
import { BrowserManager, DivarAdapter } from "@smart-finder/scraper";
import { createLogger, loadWorkerEnv, type ComponentHealth } from "@smart-finder/shared";

import { createCollectDivarHandler, COLLECT_DIVAR_JOB_TYPE } from "./divar-collection-handler.js";
import { startHealthServer } from "./health-server.js";
import { createJobPollTick, type JobHandlerRegistry } from "./job-dispatcher.js";
import { runPollLoop } from "./poll-loop.js";
import { createWorkerTelegramClient } from "./telegram-client.js";
import {
  createSendTelegramNotificationHandler,
  SEND_TELEGRAM_NOTIFICATION_JOB_TYPE,
} from "./telegram-notification-handler.js";
import { WORKER_VERSION } from "./version.js";

const DIVAR_NAVIGATION_TIMEOUT_MS = 30_000;

async function main(): Promise<void> {
  const env = loadWorkerEnv();
  const logger = createLogger({
    level: env.LOG_LEVEL,
    base: { service: "worker", version: WORKER_VERSION },
  });

  logger.info("worker starting", {
    status: "starting",
    node_env: env.NODE_ENV,
    poll_interval_ms: env.WORKER_POLL_INTERVAL_MS,
    job_batch_size: env.WORKER_JOB_BATCH_SIZE,
  });

  const pool = createPool({ env, logger, applicationName: "smart-finder-worker" });
  const telegramClient = createWorkerTelegramClient(env);
  const browserManager = new BrowserManager({ navigationTimeoutMs: DIVAR_NAVIGATION_TIMEOUT_MS });
  const divarAdapter = new DivarAdapter(DIVAR_NAVIGATION_TIMEOUT_MS);

  const JOB_HANDLERS: JobHandlerRegistry = {
    [SEND_TELEGRAM_NOTIFICATION_JOB_TYPE]: createSendTelegramNotificationHandler({
      pool,
      telegramClient,
    }),
    [COLLECT_DIVAR_JOB_TYPE]: createCollectDivarHandler({
      pool,
      browserManager,
      adapter: divarAdapter,
    }),
  };

  const probes = async (): Promise<ComponentHealth[]> => [await checkDatabaseHealth(pool)];

  const health = await startHealthServer({
    port: env.WORKER_HEALTH_PORT,
    version: WORKER_VERSION,
    logger,
    probes,
  });

  const shutdown = new AbortController();
  installSignalHandlers(shutdown, logger, env.WORKER_SHUTDOWN_TIMEOUT_MS);

  const tick = createJobPollTick({
    pool,
    handlers: JOB_HANDLERS,
    batchSize: env.WORKER_JOB_BATCH_SIZE,
    workerId: `worker-${process.pid.toString()}`,
    logger,
  });

  try {
    await runPollLoop({
      intervalMs: env.WORKER_POLL_INTERVAL_MS,
      tick,
      signal: shutdown.signal,
      logger,
    });
  } finally {
    logger.info("worker shutting down", { status: "stopping" });
    await health.close().catch((error: unknown) => {
      logger.error("health server close failed", { err: error, error_type: "shutdown_error" });
    });
    await browserManager.close().catch((error: unknown) => {
      logger.error("browser manager close failed", { err: error, error_type: "shutdown_error" });
    });
    await closePool(pool).catch((error: unknown) => {
      logger.error("pool close failed", { err: error, error_type: "shutdown_error" });
    });
    logger.info("worker stopped", { status: "stopped" });
  }
}

/**
 * First signal starts a graceful drain. A second signal, or the expiry of the grace period,
 * exits immediately — an orchestrator that has already sent SIGTERM will SIGKILL soon anyway,
 * and hanging until then only delays the restart.
 */
function installSignalHandlers(
  controller: AbortController,
  logger: ReturnType<typeof createLogger>,
  timeoutMs: number,
): void {
  let shuttingDown = false;

  const onSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      logger.warn("second signal received, exiting immediately", { signal });
      process.exit(1);
    }
    shuttingDown = true;
    logger.info("shutdown signal received", { signal, status: "draining", timeout_ms: timeoutMs });
    controller.abort();

    const forceExit = setTimeout(() => {
      logger.error("graceful shutdown timed out, forcing exit", {
        error_type: "shutdown_timeout",
      });
      process.exit(1);
    }, timeoutMs);
    forceExit.unref();
  };

  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
}

main().catch((error: unknown) => {
  // Startup failures (bad env, unreachable database at boot) are fatal and must be loud.
  const logger = createLogger({ level: "error", base: { service: "worker" } });
  logger.fatal("worker failed to start", { err: error, error_type: "startup_failed" });
  process.exitCode = 1;
});
