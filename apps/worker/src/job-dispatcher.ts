/**
 * Dispatches claimed jobs to registered handlers.
 *
 * Split into a pure dispatch core (`processClaimedJobs`, unit-testable with no database) and
 * a thin wrapper (`createJobPollTick`) that binds it to the real queue functions in
 * `@smart-finder/database`. The pattern mirrors `poll-loop.ts`'s injectable `sleep`.
 */

import {
  claimJobs,
  completeJob,
  failJob,
  type DatabasePool,
  type JobRow,
} from "@smart-finder/database";
import type { Logger } from "@smart-finder/shared";

import type { PollLoopTickResult } from "./poll-loop.js";

export interface JobHandlerContext {
  logger: Logger;
  runId: string;
}

/** A handler resolves on success; any throw is treated as a failure and triggers a retry. */
export type JobHandler = (
  payload: Record<string, unknown>,
  context: JobHandlerContext,
) => Promise<void>;

export type JobHandlerRegistry = Readonly<Record<string, JobHandler>>;

export interface JobEffects {
  onComplete: (jobId: string) => Promise<void>;
  onFail: (job: JobRow, error: string) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs every claimed job's handler and reports the outcome through `effects`. Jobs run
 * concurrently — they are independent units of work and nothing here assumes ordering between
 * them. A handler throwing, rejecting, or being entirely absent from `handlers` are all
 * reported as an ordinary failure: this must never throw itself and abort the batch, since one
 * bad job would otherwise take down every other job claimed alongside it.
 */
export async function processClaimedJobs(
  jobs: readonly JobRow[],
  handlers: JobHandlerRegistry,
  effects: JobEffects,
  logger: Logger,
  runId: string,
): Promise<void> {
  await Promise.all(
    jobs.map(async (job) => {
      const jobLogger = logger.child({ run_id: runId, job_id: job.id, source: job.job_type });
      const handler = handlers[job.job_type];

      if (handler === undefined) {
        const message = `no handler registered for job_type "${job.job_type}"`;
        jobLogger.error("job dispatch failed", { error_type: "no_handler", status: "failed" });
        await effects.onFail(job, message);
        return;
      }

      const startedAt = performance.now();
      try {
        await handler(job.payload, { logger: jobLogger, runId });
        await effects.onComplete(job.id);
        jobLogger.info("job completed", {
          status: "completed",
          duration_ms: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        const message = errorMessage(error);
        jobLogger.error("job failed", {
          err: error,
          error_type: "handler_failed",
          status: "failed",
          duration_ms: Math.round(performance.now() - startedAt),
        });
        await effects.onFail(job, message);
      }
    }),
  );
}

export interface JobPollTickOptions {
  pool: DatabasePool;
  handlers: JobHandlerRegistry;
  batchSize: number;
  workerId: string;
  logger: Logger;
  /** Injectable so tests can assert on the id without depending on `crypto.randomUUID`. */
  generateRunId?: () => string;
}

/**
 * Builds the worker's poll-loop tick: claim a batch, dispatch it, report `didWork` so the
 * loop polls again immediately while a backlog remains (see `poll-loop.ts`).
 */
export function createJobPollTick(
  options: JobPollTickOptions,
): (signal: AbortSignal) => Promise<PollLoopTickResult> {
  const { pool, handlers, batchSize, workerId, logger } = options;
  const generateRunId = options.generateRunId ?? (() => crypto.randomUUID());

  return async (): Promise<PollLoopTickResult> => {
    const runId = generateRunId();
    const jobs = await claimJobs(pool, { batchSize, workerId, runId });
    if (jobs.length === 0) return { didWork: false };

    await processClaimedJobs(
      jobs,
      handlers,
      {
        onComplete: (jobId) => completeJob(pool, jobId).then(() => undefined),
        onFail: (job, error) =>
          failJob(pool, { jobId: job.id, attempts: job.attempts, error }).then(() => undefined),
      },
      logger,
      runId,
    );

    // The batch may not have filled every slot even when work was found, but reporting
    // didWork=true either way is what makes the loop drain a backlog at full speed.
    return { didWork: true };
  };
}
