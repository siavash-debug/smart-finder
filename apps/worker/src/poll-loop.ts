/**
 * Generic polling loop for the ingest plane.
 *
 * Sequential by design: one tick never overlaps the next, so a slow tick backs pressure up
 * rather than fanning out unbounded concurrent database work. Phase 1 supplies a tick that
 * claims jobs with `FOR UPDATE SKIP LOCKED`; until then the loop runs with an idle tick.
 */

import type { Logger } from "@smart-finder/shared";

export interface PollLoopTickResult {
  /**
   * Whether the tick found work. When it did, the loop polls again immediately instead of
   * sleeping, so a backlog drains at full speed rather than one batch per interval.
   */
  didWork: boolean;
}

export interface PollLoopOptions {
  intervalMs: number;
  tick: (signal: AbortSignal) => Promise<PollLoopTickResult>;
  signal: AbortSignal;
  logger: Logger;
  /** Injectable sleep so tests do not wait in real time. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });

    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}

/**
 * Runs until `signal` aborts. A throwing tick is logged and the loop continues after the
 * normal interval: a transient database failure must not terminate the worker, because a
 * crash-restart cycle is slower to recover than a retry.
 */
export async function runPollLoop(options: PollLoopOptions): Promise<void> {
  const { intervalMs, tick, signal, logger } = options;
  const wait = options.sleep ?? sleep;

  logger.info("poll loop started", { status: "running", interval_ms: intervalMs });

  while (!signal.aborted) {
    let didWork = false;

    const startedAt = performance.now();
    try {
      const result = await tick(signal);
      didWork = result.didWork;
    } catch (error) {
      logger.error("poll loop tick failed", {
        err: error,
        error_type: "tick_failed",
        status: "failed",
        duration_ms: Math.round(performance.now() - startedAt),
      });
    }

    if (signal.aborted) break;
    if (!didWork) await wait(intervalMs, signal);
  }

  logger.info("poll loop stopped", { status: "stopped" });
}
