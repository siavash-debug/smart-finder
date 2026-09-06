import { describe, expect, it, vi } from "vitest";

import { createLogger, type LogRecord } from "@smart-finder/shared";

import { runPollLoop, type PollLoopTickResult } from "./poll-loop.js";

function silentLogger(records: LogRecord[] = []) {
  return createLogger({
    level: "trace",
    sink: (record) => {
      records.push(record);
    },
  });
}

/** Records requested delays instead of waiting, so the loop runs at full speed under test. */
function fakeSleep() {
  const delays: number[] = [];
  return {
    delays,
    sleep: (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    },
  };
}

describe("runPollLoop", () => {
  it("stops when the signal is already aborted before the first tick", async () => {
    const controller = new AbortController();
    controller.abort();
    const tick = vi.fn<() => Promise<PollLoopTickResult>>();

    await runPollLoop({
      intervalMs: 100,
      tick,
      signal: controller.signal,
      logger: silentLogger(),
      sleep: () => Promise.resolve(),
    });

    expect(tick).not.toHaveBeenCalled();
  });

  it("sleeps between ticks when there was no work", async () => {
    const controller = new AbortController();
    const { delays, sleep } = fakeSleep();
    let calls = 0;

    const tick = (): Promise<PollLoopTickResult> => {
      calls += 1;
      if (calls === 3) controller.abort();
      return Promise.resolve({ didWork: false });
    };

    await runPollLoop({
      intervalMs: 2000,
      tick,
      signal: controller.signal,
      logger: silentLogger(),
      sleep,
    });

    expect(calls).toBe(3);
    expect(delays).toEqual([2000, 2000]);
  });

  it("polls again immediately while work is being found", async () => {
    const controller = new AbortController();
    const { delays, sleep } = fakeSleep();
    let calls = 0;

    const tick = (): Promise<PollLoopTickResult> => {
      calls += 1;
      if (calls === 3) controller.abort();
      return Promise.resolve({ didWork: true });
    };

    await runPollLoop({
      intervalMs: 2000,
      tick,
      signal: controller.signal,
      logger: silentLogger(),
      sleep,
    });

    expect(calls).toBe(3);
    expect(delays).toEqual([]);
  });

  it("keeps running after a tick throws and logs the failure", async () => {
    const controller = new AbortController();
    const { sleep } = fakeSleep();
    const records: LogRecord[] = [];
    let calls = 0;

    const tick = (): Promise<PollLoopTickResult> => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("connection reset"));
      controller.abort();
      return Promise.resolve({ didWork: false });
    };

    await runPollLoop({
      intervalMs: 50,
      tick,
      signal: controller.signal,
      logger: silentLogger(records),
      sleep,
    });

    expect(calls).toBe(2);
    const failure = records.find((r) => r.error_type === "tick_failed");
    expect(failure).toBeDefined();
    expect(failure?.level).toBe("error");
  });

  it("does not sleep after the signal aborts during a tick", async () => {
    const controller = new AbortController();
    const { delays, sleep } = fakeSleep();

    const tick = (): Promise<PollLoopTickResult> => {
      controller.abort();
      return Promise.resolve({ didWork: false });
    };

    await runPollLoop({
      intervalMs: 5000,
      tick,
      signal: controller.signal,
      logger: silentLogger(),
      sleep,
    });

    expect(delays).toEqual([]);
  });

  it("passes the abort signal through to the tick", async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;

    const tick = (signal: AbortSignal): Promise<PollLoopTickResult> => {
      received = signal;
      controller.abort();
      return Promise.resolve({ didWork: false });
    };

    await runPollLoop({
      intervalMs: 10,
      tick,
      signal: controller.signal,
      logger: silentLogger(),
      sleep: () => Promise.resolve(),
    });

    expect(received).toBe(controller.signal);
  });
});
