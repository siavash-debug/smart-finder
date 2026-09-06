import { describe, expect, it } from "vitest";

import { createLogger, type LogLevel, type LogRecord } from "./logger.js";

function captureLogger(level: LogLevel) {
  const lines: string[] = [];
  const records: LogRecord[] = [];
  const logger = createLogger({
    level,
    sink: (record, line) => {
      records.push(record);
      lines.push(line);
    },
    now: () => new Date("2026-09-06T12:00:00.000Z"),
  });
  return { logger, lines, records };
}

/** `JSON.parse` returns `any`; narrow once here so assertions stay type-safe. */
function parseLine(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>;
}

describe("createLogger", () => {
  it("emits one parseable JSON object per line", () => {
    const { logger, lines } = captureLogger("info");

    logger.info("collection finished", { source: "divar", duration_ms: 1200 });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    expect(parseLine(lines[0]!)).toEqual({
      level: "info",
      time: "2026-09-06T12:00:00.000Z",
      msg: "collection finished",
      source: "divar",
      duration_ms: 1200,
    });
  });

  it("suppresses records below the configured level", () => {
    const { logger, records } = captureLogger("warn");

    logger.trace("t");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(records.map((record) => record.level)).toEqual(["warn", "error"]);
  });

  it("merges bound context from child loggers", () => {
    const { logger, records } = captureLogger("info");

    const runLogger = logger.child({ run_id: "run-1" });
    const jobLogger = runLogger.child({ job_id: "job-9" });

    jobLogger.info("claimed", { status: "processing" });

    expect(records[0]).toMatchObject({
      run_id: "run-1",
      job_id: "job-9",
      status: "processing",
    });
  });

  it("lets call-site context override bound context", () => {
    const { logger, records } = captureLogger("info");

    logger.child({ status: "pending" }).info("update", { status: "completed" });

    expect(records[0]?.status).toBe("completed");
  });

  it("redacts sensitive keys at any depth", () => {
    const { logger, lines } = captureLogger("info");

    logger.info("config loaded", {
      DATABASE_URL: "postgresql://user:hunter2@db/app",
      nested: { token: "abc123", phone: "+989120000000", safe: "keep" },
      list: [{ password: "p" }],
    });

    const line = lines[0]!;
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("abc123");
    expect(line).not.toContain("989120000000");

    const parsed = parseLine(line);
    expect(parsed.DATABASE_URL).toBe("[redacted]");
    expect(parsed.nested).toEqual({
      token: "[redacted]",
      phone: "[redacted]",
      safe: "keep",
    });
    expect(parsed.list).toEqual([{ password: "[redacted]" }]);
  });

  it("serializes Error values including the cause chain", () => {
    const { logger, lines } = captureLogger("error");

    const cause = new Error("connection refused");
    logger.error("query failed", { err: new Error("db unavailable", { cause }) });

    const parsed = parseLine(lines[0]!);
    expect(parsed.err).toMatchObject({
      name: "Error",
      message: "db unavailable",
      cause: { name: "Error", message: "connection refused" },
    });
    expect(parsed.err).toHaveProperty("stack", expect.any(String));
  });

  it("does not throw when context contains a cycle", () => {
    const { logger, lines } = captureLogger("info");

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => {
      logger.info("cyclic", { cyclic });
    }).not.toThrow();
    expect(parseLine(lines[0]!).cyclic).toBeDefined();
  });

  it("routes error and fatal records to a distinguishable level field", () => {
    const { logger, records } = captureLogger("trace");

    logger.error("boom");
    logger.fatal("worse");

    expect(records.map((record) => record.level)).toEqual(["error", "fatal"]);
  });
});
