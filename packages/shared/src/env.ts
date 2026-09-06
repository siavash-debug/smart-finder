/**
 * Environment loading and validation.
 *
 * Every process validates its environment once, at startup, and exits on a malformed value
 * rather than failing later at an arbitrary call site. Schemas are composed per plane so the
 * worker never receives web-only secrets and vice versa (ARCHITECTURE §7).
 */

import { z } from "zod";
import { LOG_LEVELS } from "./logger.js";

/** `"true"`/`"false"` are the only forms an env var can take; anything else is a typo. */
const envBoolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .describe("true or false");

const envInt = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max) as z.ZodType<number, unknown>;

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});

const databaseSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "must be a postgres:// or postgresql:// connection string",
    ),
  DATABASE_POOL_MAX: envInt(1, 100).default(10),
  DATABASE_IDLE_TIMEOUT_MS: envInt(0, 600_000).default(30_000),
  DATABASE_CONNECTION_TIMEOUT_MS: envInt(100, 120_000).default(10_000),
  DATABASE_SSL: envBoolean.default(false),
});

const webSchema = baseSchema.extend({
  ...databaseSchema.shape,
  PORT: envInt(1, 65_535).default(3000),
  APP_URL: z.url().default("http://localhost:3000"),
});

const workerSchema = baseSchema.extend({
  ...databaseSchema.shape,
  WORKER_HEALTH_PORT: envInt(1, 65_535).default(3001),
  WORKER_JOB_BATCH_SIZE: envInt(1, 100).default(5),
  WORKER_POLL_INTERVAL_MS: envInt(100, 300_000).default(2_000),
  WORKER_SHUTDOWN_TIMEOUT_MS: envInt(0, 300_000).default(15_000),
});

export type BaseEnv = z.infer<typeof baseSchema>;
export type DatabaseEnv = z.infer<typeof databaseSchema>;
export type WebEnv = z.infer<typeof webSchema>;
export type WorkerEnv = z.infer<typeof workerSchema>;

/** Raised when validation fails. The message names offending keys but never their values. */
export class EnvValidationError extends Error {
  public readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

/**
 * Values are intentionally omitted from error output: an env var that fails validation is
 * frequently a secret, and startup errors are the most widely copied text in an incident.
 */
function parseOrThrow<T>(schema: z.ZodType<T>, source: Record<string, string | undefined>): T {
  const result = schema.safeParse(source);
  if (result.success) return result.data;

  const issues = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
  throw new EnvValidationError(issues);
}

export function loadWebEnv(source: Record<string, string | undefined> = process.env): WebEnv {
  return parseOrThrow(webSchema, source);
}

export function loadWorkerEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  return parseOrThrow(workerSchema, source);
}

export function loadDatabaseEnv(
  source: Record<string, string | undefined> = process.env,
): DatabaseEnv {
  return parseOrThrow(databaseSchema, source);
}

export const envSchemas = {
  base: baseSchema,
  database: databaseSchema,
  web: webSchema,
  worker: workerSchema,
} as const;
