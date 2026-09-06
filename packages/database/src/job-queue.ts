/**
 * Job queue on top of the `job` table (MASTER_PROMPT §25).
 *
 * Claiming uses `SELECT ... FOR UPDATE SKIP LOCKED` inside a single `UPDATE ... FROM` — one
 * statement, so it is atomic without an explicit transaction, and two workers polling at once
 * never claim the same row.
 */

import type { Queryable } from "./pool.js";
import type { JobRow, JobStatus } from "./domain.js";

export interface EnqueueJobInput {
  jobType: string;
  payload?: Record<string, unknown>;
  /** Defaults to now — the job is immediately eligible for claiming. */
  runAt?: Date;
  /** Higher runs first among jobs otherwise due at the same time. Default 0. */
  priority?: number;
  maxAttempts?: number;
}

export async function enqueueJob(pool: Queryable, input: EnqueueJobInput): Promise<JobRow> {
  const { rows } = await pool.query<JobRow>(
    `INSERT INTO job (job_type, payload, run_at, priority, max_attempts)
     VALUES ($1, $2, COALESCE($3, now()), COALESCE($4, 0), COALESCE($5, 5))
     RETURNING *`,
    [
      input.jobType,
      input.payload ?? {},
      input.runAt ?? null,
      input.priority ?? null,
      input.maxAttempts ?? null,
    ],
  );
  return rows[0]!;
}

export interface ClaimJobsInput {
  batchSize: number;
  /** Identifies the claiming process, stored in `locked_by` for lock debugging. */
  workerId: string;
  /** Correlates every job claimed in this batch back to one worker tick in the logs. */
  runId?: string;
}

/**
 * Claims up to `batchSize` due, pending jobs and marks them `processing`. Each claimed row's
 * `attempts` is incremented immediately — a claim always counts as an attempt, whether or not
 * the handler ever runs to completion (e.g. the process crashes mid-job).
 */
export async function claimJobs(pool: Queryable, input: ClaimJobsInput): Promise<JobRow[]> {
  const { rows } = await pool.query<JobRow>(
    `WITH claimed AS (
       SELECT id FROM job
       WHERE status = 'pending' AND run_at <= now()
       ORDER BY priority DESC, run_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE job
     SET status = 'processing',
         locked_at = now(),
         locked_by = $2,
         run_id = $3,
         attempts = attempts + 1
     FROM claimed
     WHERE job.id = claimed.id
     RETURNING job.*`,
    [input.batchSize, input.workerId, input.runId ?? null],
  );
  return rows;
}

/** Marks a claimed job done. A no-op (returns false) if the job was not in `processing`. */
export async function completeJob(pool: Queryable, jobId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE job SET status = 'completed', completed_at = now()
     WHERE id = $1 AND status = 'processing'`,
    [jobId],
  );
  return rowCount === 1;
}

/**
 * Full jitter exponential backoff, base 1s, capped at 5 minutes. `attempts` is the job's
 * attempt count *after* the failing claim, so the first retry (attempts=1) waits up to 1s,
 * the second (attempts=2) up to 2s, and so on. Jitter avoids every job that failed together
 * (e.g. a source outage) retrying in lockstep.
 */
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 5 * 60 * 1_000;

export function computeBackoffMs(attempts: number, random: () => number = Math.random): number {
  const exponential = BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1);
  const capped = Math.min(exponential, BACKOFF_MAX_MS);
  return Math.round(random() * capped);
}

export interface FailJobInput {
  jobId: string;
  /**
   * The job's current `attempts` (from the `JobRow` the caller already holds after
   * `claimJobs`), used to size the backoff. Getting this from the caller avoids an extra
   * round-trip to re-read a value the caller already has.
   */
  attempts: number;
  error: string;
  /** Injectable for deterministic tests; defaults to `computeBackoffMs(attempts)`. */
  backoffMs?: number;
}

/**
 * Marks a claimed job failed. If it still has attempts remaining it goes back to `pending`
 * with a backoff-delayed `run_at`; otherwise it is terminally `failed`. Either way the lock
 * fields are cleared so a stuck lock never blocks a legitimate future claim.
 */
export async function failJob(pool: Queryable, input: FailJobInput): Promise<JobRow | null> {
  const backoffMs = input.backoffMs ?? computeBackoffMs(input.attempts);
  const { rows } = await pool.query<JobRow>(
    `UPDATE job
     SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
         run_at = CASE
           WHEN attempts >= max_attempts THEN run_at
           ELSE now() + make_interval(secs => $2::double precision / 1000)
         END,
         locked_at = NULL,
         locked_by = NULL,
         last_error = $3
     WHERE id = $1
     RETURNING *`,
    [input.jobId, backoffMs, input.error],
  );
  return rows[0] ?? null;
}

export async function getJobById(pool: Queryable, jobId: string): Promise<JobRow | null> {
  const { rows } = await pool.query<JobRow>("SELECT * FROM job WHERE id = $1", [jobId]);
  return rows[0] ?? null;
}

export async function countJobsByStatus(pool: Queryable, status: JobStatus): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM job WHERE status = $1",
    [status],
  );
  return Number(rows[0]?.count ?? "0");
}
