/**
 * Structured JSON logging.
 *
 * One JSON object per line on stdout (stderr for `error`/`fatal`), which is what container
 * log collectors expect. Deliberately dependency-free: the requirements from
 * MASTER_PROMPT §27 are level filtering, bound context fields, and secret redaction, all of
 * which fit in this file and stay trivially unit-testable.
 */

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Context fields carried alongside a log line. The named fields are the ones
 * MASTER_PROMPT §27 requires so that a pipeline pass can be traced from logs alone; the
 * index signature allows call-site specific detail.
 */
export interface LogContext {
  run_id?: string;
  job_id?: string;
  source?: string;
  posting_id?: string;
  property_id?: string;
  user_id?: string;
  duration_ms?: number;
  status?: string;
  error_type?: string;
  [key: string]: unknown;
}

export interface LogRecord extends LogContext {
  level: LogLevel;
  time: string;
  msg: string;
}

/**
 * Keys whose values are replaced with `[redacted]`. Matched case-insensitively against the
 * whole key, so `DATABASE_URL` and `database_url` are both covered.
 */
const REDACTED_KEYS = new Set(
  [
    "password",
    "pass",
    "token",
    "secret",
    "authorization",
    "cookie",
    "api_key",
    "apikey",
    "database_url",
    "telegram_bot_token",
    "anthropic_api_key",
    "phone",
    "phone_number",
  ].map((key) => key.toLowerCase()),
);

const REDACTED = "[redacted]";

/** Depth limit guards against cycles and pathological nesting from external payloads. */
const MAX_REDACT_DEPTH = 6;

function redact(value: unknown, depth = 0): unknown {
  if (depth >= MAX_REDACT_DEPTH) return "[truncated]";
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED : redact(nested, depth + 1);
  }
  return out;
}

/**
 * Errors do not survive `JSON.stringify` (name/message/stack are non-enumerable), so they are
 * converted explicitly. `cause` is followed one level, which is where wrapped driver errors
 * usually hide.
 */
function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: error.name,
      message: error.message,
    };
    if (error.stack !== undefined) serialized.stack = error.stack;
    if (error.cause !== undefined) serialized.cause = serializeError(error.cause);
    return serialized;
  }
  return { message: String(error) };
}

export interface Logger {
  trace(msg: string, context?: LogContext): void;
  debug(msg: string, context?: LogContext): void;
  info(msg: string, context?: LogContext): void;
  warn(msg: string, context?: LogContext): void;
  error(msg: string, context?: LogContext): void;
  fatal(msg: string, context?: LogContext): void;
  /** Returns a logger that merges `context` into every record it emits. */
  child(context: LogContext): Logger;
}

/** Where a serialized record is written. Overridable so tests can capture output. */
export type LogSink = (record: LogRecord, line: string) => void;

const defaultSink: LogSink = (record, line) => {
  if (record.level === "error" || record.level === "fatal") {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
};

export interface LoggerOptions {
  level?: LogLevel;
  /** Fields merged into every record. */
  base?: LogContext;
  sink?: LogSink;
  /** Injectable clock, so tests can assert on `time`. */
  now?: () => Date;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const base = options.base ?? {};
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date());
  const threshold = LEVEL_RANK[level];

  function emit(recordLevel: LogLevel, msg: string, context?: LogContext): void {
    if (LEVEL_RANK[recordLevel] < threshold) return;

    const merged: LogContext = { ...base, ...context };
    if (merged.err !== undefined) {
      merged.err = serializeError(merged.err);
    }

    const record = {
      level: recordLevel,
      time: now().toISOString(),
      msg,
      ...(redact(merged) as LogContext),
    } satisfies LogRecord;

    // A non-serializable field must never take down the caller.
    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      line = JSON.stringify({
        level: recordLevel,
        time: record.time,
        msg,
        log_error: "context_not_serializable",
      });
    }

    sink(record, line);
  }

  return {
    trace: (msg, context) => emit("trace", msg, context),
    debug: (msg, context) => emit("debug", msg, context),
    info: (msg, context) => emit("info", msg, context),
    warn: (msg, context) => emit("warn", msg, context),
    error: (msg, context) => emit("error", msg, context),
    fatal: (msg, context) => emit("fatal", msg, context),
    child: (context) =>
      createLogger({
        level,
        base: { ...base, ...context },
        sink,
        now,
      }),
  };
}

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}
