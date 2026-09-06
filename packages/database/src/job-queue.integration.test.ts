/**
 * Integration tests for the `job` queue against a real PostgreSQL instance.
 *
 * Skips itself (not fails) when no database is reachable — see `test-support/db.ts`. Run
 * `npm run db:up` first to exercise these for real.
 */

import { afterAll, describe, expect, it } from "vitest";

import {
  claimJobs,
  completeJob,
  computeBackoffMs,
  countJobsByStatus,
  enqueueJob,
  failJob,
  getJobById,
} from "./job-queue.js";
import {
  closeTestPool,
  deleteTestJobsByType,
  getTestPool,
  isTestDatabaseAvailable,
} from "./test-support/db.js";

// Top-level await: Vitest collects an ESM test file as a module and awaits its top-level
// promise before running it, so `available` is a resolved boolean by the time `it.runIf`
// below reads it. A plain `beforeAll` would not work here — its callback runs during
// execution, after `it.runIf`'s argument has already been evaluated during collection.
const available = await isTestDatabaseAvailable();

/** One job_type per test, so tests never see each other's rows and cleanup is targeted. */
function uniqueJobType(name: string): string {
  return `test:${name}:${Date.now().toString()}:${Math.random().toString(36).slice(2)}`;
}

describe("job queue (integration)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it.runIf(available)("enqueues a job with documented defaults", async () => {
    const pool = getTestPool();
    const jobType = uniqueJobType("enqueue-defaults");

    const job = await enqueueJob(pool, { jobType });

    expect(job).toMatchObject({
      job_type: jobType,
      status: "pending",
      priority: 0,
      attempts: 0,
      max_attempts: 5,
      payload: {},
    });
    expect(job.run_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    await deleteTestJobsByType(jobType);
  });

  it.runIf(available)("claims a pending job with SKIP LOCKED and increments attempts", async () => {
    const pool = getTestPool();
    const jobType = uniqueJobType("claim-basic");
    await enqueueJob(pool, { jobType, payload: { foo: "bar" } });

    const claimed = await claimJobs(pool, { batchSize: 5, workerId: "test-worker" });
    const ours = claimed.filter((j) => j.job_type === jobType);

    expect(ours).toHaveLength(1);
    expect(ours[0]).toMatchObject({
      status: "processing",
      attempts: 1,
      locked_by: "test-worker",
      payload: { foo: "bar" },
    });
    expect(ours[0]!.locked_at).not.toBeNull();

    await deleteTestJobsByType(jobType);
  });

  it.runIf(available)("does not claim a job scheduled in the future", async () => {
    const pool = getTestPool();
    const jobType = uniqueJobType("claim-future");
    await enqueueJob(pool, { jobType, runAt: new Date(Date.now() + 60_000) });

    const claimed = await claimJobs(pool, { batchSize: 10, workerId: "test-worker" });

    expect(claimed.filter((j) => j.job_type === jobType)).toHaveLength(0);

    await deleteTestJobsByType(jobType);
  });

  it.runIf(available)("never lets two concurrent claimers take the same job", async () => {
    const pool = getTestPool();
    const jobType = uniqueJobType("claim-concurrent");
    await enqueueJob(pool, { jobType });

    // Two claims racing for the same single job: SKIP LOCKED must give it to exactly one.
    const [a, b] = await Promise.all([
      claimJobs(pool, { batchSize: 5, workerId: "worker-a" }),
      claimJobs(pool, { batchSize: 5, workerId: "worker-b" }),
    ]);

    const ours = [...a, ...b].filter((j) => j.job_type === jobType);
    expect(ours).toHaveLength(1);

    await deleteTestJobsByType(jobType);
  });

  it.runIf(available)("respects priority, highest first, among due jobs", async () => {
    const pool = getTestPool();
    const jobType = uniqueJobType("claim-priority");
    await enqueueJob(pool, { jobType, priority: 1, payload: { rank: "low" } });
    await enqueueJob(pool, { jobType, priority: 10, payload: { rank: "high" } });

    const claimed = await claimJobs(pool, { batchSize: 1, workerId: "test-worker" });
    const ours = claimed.filter((j) => j.job_type === jobType);

    expect(ours).toHaveLength(1);
    expect(ours[0]!.payload).toEqual({ rank: "high" });

    await deleteTestJobsByType(jobType);
  });

  it.runIf(available)("completeJob marks a processing job completed", async () => {
    const pool = getTestPool();
    const jobType = uniqueJobType("complete-basic");
    await enqueueJob(pool, { jobType });
    const [claimed] = await claimJobs(pool, { batchSize: 1, workerId: "test-worker" });

    const didComplete = await completeJob(pool, claimed!.id);
    const after = await getJobById(pool, claimed!.id);

    expect(didComplete).toBe(true);
    expect(after?.status).toBe("completed");
    expect(after?.completed_at).not.toBeNull();

    await deleteTestJobsByType(jobType);
  });

  it.runIf(available)("completeJob is a no-op on a job that is not processing", async () => {
    const pool = getTestPool();
    const jobType = uniqueJobType("complete-noop");
    const job = await enqueueJob(pool, { jobType }); // still pending, never claimed

    const didComplete = await completeJob(pool, job.id);

    expect(didComplete).toBe(false);

    await deleteTestJobsByType(jobType);
  });

  it.runIf(available)("failJob retries with backoff while attempts remain", async () => {
    const pool = getTestPool();
    const jobType = uniqueJobType("fail-retry");
    await enqueueJob(pool, { jobType, maxAttempts: 3 });
    const [claimed] = await claimJobs(pool, { batchSize: 1, workerId: "test-worker" });

    const result = await failJob(pool, {
      jobId: claimed!.id,
      attempts: claimed!.attempts,
      error: "boom",
      backoffMs: 0,
    });

    expect(result).toMatchObject({ status: "pending", last_error: "boom", locked_by: null });
    expect(result!.attempts).toBe(1);

    await deleteTestJobsByType(jobType);
  });

  it.runIf(available)("failJob terminally fails once attempts are exhausted", async () => {
    const pool = getTestPool();
    const jobType = uniqueJobType("fail-exhausted");
    await enqueueJob(pool, { jobType, maxAttempts: 1 });
    const [claimed] = await claimJobs(pool, { batchSize: 1, workerId: "test-worker" });

    const result = await failJob(pool, {
      jobId: claimed!.id,
      attempts: claimed!.attempts,
      error: "still boom",
    });

    expect(result?.status).toBe("failed");

    await deleteTestJobsByType(jobType);
  });

  it.runIf(available)("a failed-and-retried job becomes claimable again", async () => {
    const pool = getTestPool();
    const jobType = uniqueJobType("fail-then-reclaim");
    await enqueueJob(pool, { jobType, maxAttempts: 3 });
    const [claimed] = await claimJobs(pool, { batchSize: 1, workerId: "test-worker" });
    await failJob(pool, {
      jobId: claimed!.id,
      attempts: claimed!.attempts,
      error: "transient",
      backoffMs: 0,
    });

    const reclaimed = await claimJobs(pool, { batchSize: 5, workerId: "test-worker-2" });
    const ours = reclaimed.filter((j) => j.job_type === jobType);

    expect(ours).toHaveLength(1);
    expect(ours[0]!.attempts).toBe(2);

    await deleteTestJobsByType(jobType);
  });

  it.runIf(available)("countJobsByStatus reflects claims and completions", async () => {
    const pool = getTestPool();
    const jobType = uniqueJobType("count-status");
    const before = await countJobsByStatus(pool, "pending");
    await enqueueJob(pool, { jobType });

    const afterEnqueue = await countJobsByStatus(pool, "pending");
    expect(afterEnqueue).toBe(before + 1);

    await deleteTestJobsByType(jobType);
  });
});

describe("computeBackoffMs (pure)", () => {
  it("grows exponentially with attempts, capped, before jitter", () => {
    const noJitter = () => 1; // full jitter multiplier of 1 == the cap itself
    expect(computeBackoffMs(1, noJitter)).toBe(1_000);
    expect(computeBackoffMs(2, noJitter)).toBe(2_000);
    expect(computeBackoffMs(3, noJitter)).toBe(4_000);
    expect(computeBackoffMs(10, noJitter)).toBe(5 * 60 * 1_000); // capped
  });

  it("is bounded below by zero and above by the cap regardless of jitter", () => {
    for (const attempts of [1, 2, 5, 20]) {
      const value = computeBackoffMs(attempts, () => 0.5);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(5 * 60 * 1_000);
    }
  });

  it("treats non-positive attempts as attempt 1", () => {
    expect(computeBackoffMs(0, () => 1)).toBe(1_000);
    expect(computeBackoffMs(-5, () => 1)).toBe(1_000);
  });
});
