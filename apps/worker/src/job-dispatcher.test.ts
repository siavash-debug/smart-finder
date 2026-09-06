import { describe, expect, it, vi } from "vitest";

import { createLogger, type LogRecord } from "@smart-finder/shared";
import type { JobRow } from "@smart-finder/database";

import {
  processClaimedJobs,
  type JobEffects,
  type JobHandlerContext,
  type JobHandlerRegistry,
} from "./job-dispatcher.js";

function makeJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "job-1",
    job_type: "noop",
    payload: {},
    status: "processing",
    priority: 0,
    attempts: 1,
    max_attempts: 5,
    run_at: new Date(),
    locked_at: new Date(),
    locked_by: "worker-1",
    run_id: "run-1",
    last_error: null,
    created_at: new Date(),
    updated_at: new Date(),
    completed_at: null,
    ...overrides,
  };
}

function silentLogger(records: LogRecord[] = []) {
  return createLogger({ level: "trace", sink: (record) => records.push(record) });
}

function fakeEffects(): JobEffects & {
  completed: string[];
  failed: { job: JobRow; error: string }[];
} {
  const completed: string[] = [];
  const failed: { job: JobRow; error: string }[] = [];
  return {
    completed,
    failed,
    onComplete: (jobId) => {
      completed.push(jobId);
      return Promise.resolve();
    },
    onFail: (job, error) => {
      failed.push({ job, error });
      return Promise.resolve();
    },
  };
}

describe("processClaimedJobs", () => {
  it("completes a job whose handler resolves", async () => {
    const job = makeJob({ id: "job-ok" });
    const handlers: JobHandlerRegistry = { noop: () => Promise.resolve() };
    const effects = fakeEffects();

    await processClaimedJobs([job], handlers, effects, silentLogger(), "run-1");

    expect(effects.completed).toEqual(["job-ok"]);
    expect(effects.failed).toEqual([]);
  });

  it("fails a job whose handler throws, with the thrown message", async () => {
    const job = makeJob({ id: "job-throws" });
    const handlers: JobHandlerRegistry = {
      noop: () => Promise.reject(new Error("downstream unavailable")),
    };
    const effects = fakeEffects();

    await processClaimedJobs([job], handlers, effects, silentLogger(), "run-1");

    expect(effects.completed).toEqual([]);
    expect(effects.failed).toEqual([{ job, error: "downstream unavailable" }]);
  });

  it("fails a job with no registered handler, without throwing", async () => {
    const job = makeJob({ id: "job-orphan", job_type: "unregistered_type" });
    const effects = fakeEffects();

    await expect(
      processClaimedJobs([job], {}, effects, silentLogger(), "run-1"),
    ).resolves.toBeUndefined();

    expect(effects.failed).toEqual([
      { job, error: 'no handler registered for job_type "unregistered_type"' },
    ]);
  });

  it("one job failing does not stop the others in the same batch from completing", async () => {
    const good = makeJob({ id: "good", job_type: "good" });
    const bad = makeJob({ id: "bad", job_type: "bad" });
    const handlers: JobHandlerRegistry = {
      good: () => Promise.resolve(),
      bad: () => Promise.reject(new Error("boom")),
    };
    const effects = fakeEffects();

    await processClaimedJobs([good, bad], handlers, effects, silentLogger(), "run-1");

    expect(effects.completed).toEqual(["good"]);
    expect(effects.failed).toHaveLength(1);
    expect(effects.failed[0]?.job.id).toBe("bad");
  });

  it("processes an empty batch without calling any effect", async () => {
    const effects = fakeEffects();

    await processClaimedJobs([], {}, effects, silentLogger(), "run-1");

    expect(effects.completed).toEqual([]);
    expect(effects.failed).toEqual([]);
  });

  it("passes the job payload and a scoped logger/runId into the handler", async () => {
    const job = makeJob({ id: "job-ctx", job_type: "with_payload", payload: { url: "x" } });
    // The mock's implementation must match JobHandler's arity, or `vi.fn` infers a zero-arg
    // signature from the callback and `mock.calls[0]` comes back typed as an empty tuple.
    const handler = vi.fn((_payload: Record<string, unknown>, _context: JobHandlerContext) =>
      Promise.resolve(),
    );
    const effects = fakeEffects();

    await processClaimedJobs([job], { with_payload: handler }, effects, silentLogger(), "run-42");

    expect(handler).toHaveBeenCalledTimes(1);
    const [payload, context] = handler.mock.calls[0]!;
    expect(payload).toEqual({ url: "x" });
    expect(context.runId).toBe("run-42");
    expect(context.logger).toBeDefined();
  });

  it("logs a failure record for a thrown handler error", async () => {
    const job = makeJob({ id: "job-log" });
    const handlers: JobHandlerRegistry = { noop: () => Promise.reject(new Error("nope")) };
    const records: LogRecord[] = [];

    await processClaimedJobs([job], handlers, fakeEffects(), silentLogger(records), "run-1");

    const failure = records.find((r) => r.error_type === "handler_failed");
    expect(failure).toBeDefined();
    expect(failure?.job_id).toBe("job-log");
  });

  it("converts a non-Error rejection to a string message", async () => {
    const job = makeJob({ id: "job-nonerror" });
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberately non-Error, to test the fallback path
    const handlers: JobHandlerRegistry = { noop: () => Promise.reject("plain string failure") };
    const effects = fakeEffects();

    await processClaimedJobs([job], handlers, effects, silentLogger(), "run-1");

    expect(effects.failed[0]?.error).toBe("plain string failure");
  });
});
