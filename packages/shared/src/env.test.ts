import { describe, expect, it } from "vitest";

import { EnvValidationError, loadWebEnv, loadWorkerEnv } from "./env.js";

const VALID_DB_URL = "postgresql://smartfinder:secretpw@localhost:5432/smartfinder";
const VALID_BOT_TOKEN = "123456789:AAExampleTokenNotARealSecretValueXYZ";
const VALID_WEBHOOK_SECRET = "a-webhook-secret_1234567890";

const VALID_WEB_SOURCE = {
  DATABASE_URL: VALID_DB_URL,
  TELEGRAM_BOT_TOKEN: VALID_BOT_TOKEN,
  TELEGRAM_WEBHOOK_SECRET: VALID_WEBHOOK_SECRET,
};
const VALID_WORKER_SOURCE = { DATABASE_URL: VALID_DB_URL, TELEGRAM_BOT_TOKEN: VALID_BOT_TOKEN };

describe("loadWebEnv", () => {
  it("applies documented defaults when only required values are present", () => {
    const env = loadWebEnv(VALID_WEB_SOURCE);

    expect(env).toMatchObject({
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      PORT: 3000,
      APP_URL: "http://localhost:3000",
      DATABASE_POOL_MAX: 10,
      DATABASE_SSL: false,
    });
  });

  it("coerces numeric strings to numbers", () => {
    const env = loadWebEnv({ ...VALID_WEB_SOURCE, PORT: "8080", DATABASE_POOL_MAX: "25" });

    expect(env.PORT).toBe(8080);
    expect(env.DATABASE_POOL_MAX).toBe(25);
  });

  it("parses booleans only from the exact strings true and false", () => {
    expect(loadWebEnv({ ...VALID_WEB_SOURCE, DATABASE_SSL: "true" }).DATABASE_SSL).toBe(true);
    expect(() => loadWebEnv({ ...VALID_WEB_SOURCE, DATABASE_SSL: "1" })).toThrow(
      EnvValidationError,
    );
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => loadWebEnv({ ...VALID_WEB_SOURCE, DATABASE_URL: undefined })).toThrow(
      EnvValidationError,
    );
  });

  it("rejects a non-postgres connection string", () => {
    expect(() =>
      loadWebEnv({ ...VALID_WEB_SOURCE, DATABASE_URL: "mysql://localhost/app" }),
    ).toThrow(/postgres:\/\/ or postgresql:\/\//);
  });

  it("rejects an out-of-range port", () => {
    expect(() => loadWebEnv({ ...VALID_WEB_SOURCE, PORT: "70000" })).toThrow(EnvValidationError);
  });

  it("never includes the offending value in the error message", () => {
    let message = "";
    try {
      loadWebEnv({ ...VALID_WEB_SOURCE, DATABASE_URL: "mysql://user:hunter2@localhost/app" });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain("hunter2");
  });

  it("lists every failing key rather than stopping at the first", () => {
    let issues: readonly string[] = [];
    try {
      loadWebEnv({ ...VALID_WEB_SOURCE, DATABASE_URL: "nope", PORT: "-1", LOG_LEVEL: "chatty" });
    } catch (error) {
      issues = (error as EnvValidationError).issues;
    }

    const keys = issues.join(" ");
    expect(keys).toContain("DATABASE_URL");
    expect(keys).toContain("PORT");
    expect(keys).toContain("LOG_LEVEL");
  });

  describe("Telegram configuration", () => {
    it("rejects a missing bot token", () => {
      expect(() => loadWebEnv({ ...VALID_WEB_SOURCE, TELEGRAM_BOT_TOKEN: undefined })).toThrow(
        EnvValidationError,
      );
    });

    it("rejects a bot token that doesn't look like digits:secret", () => {
      expect(() => loadWebEnv({ ...VALID_WEB_SOURCE, TELEGRAM_BOT_TOKEN: "not-a-token" })).toThrow(
        EnvValidationError,
      );
    });

    it("rejects a missing webhook secret", () => {
      expect(() => loadWebEnv({ ...VALID_WEB_SOURCE, TELEGRAM_WEBHOOK_SECRET: undefined })).toThrow(
        EnvValidationError,
      );
    });

    it("rejects a webhook secret containing characters Telegram disallows", () => {
      expect(() =>
        loadWebEnv({ ...VALID_WEB_SOURCE, TELEGRAM_WEBHOOK_SECRET: "has a space" }),
      ).toThrow(EnvValidationError);
    });

    it("never includes the bot token value in a validation error message", () => {
      let message = "";
      try {
        loadWebEnv({ ...VALID_WEB_SOURCE, TELEGRAM_BOT_TOKEN: "invalid", PORT: "-1" });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("TELEGRAM_BOT_TOKEN");
      expect(message).not.toContain("invalid");
    });
  });
});

describe("loadWorkerEnv", () => {
  it("applies worker defaults", () => {
    const env = loadWorkerEnv(VALID_WORKER_SOURCE);

    expect(env).toMatchObject({
      WORKER_HEALTH_PORT: 3001,
      WORKER_JOB_BATCH_SIZE: 5,
      WORKER_POLL_INTERVAL_MS: 2000,
      WORKER_SHUTDOWN_TIMEOUT_MS: 15000,
    });
  });

  it("does not expose web-only configuration to the worker plane", () => {
    const env = loadWorkerEnv({ ...VALID_WORKER_SOURCE, APP_URL: "http://example.test" });

    expect(env).not.toHaveProperty("APP_URL");
    expect(env).not.toHaveProperty("PORT");
  });

  it("requires a bot token but not a webhook secret — the worker only sends, never verifies", () => {
    expect(() => loadWorkerEnv({ DATABASE_URL: VALID_DB_URL })).toThrow(EnvValidationError);

    const env = loadWorkerEnv(VALID_WORKER_SOURCE);
    expect(env).not.toHaveProperty("TELEGRAM_WEBHOOK_SECRET");
  });

  it("rejects a poll interval below the documented minimum", () => {
    expect(() => loadWorkerEnv({ ...VALID_WORKER_SOURCE, WORKER_POLL_INTERVAL_MS: "10" })).toThrow(
      EnvValidationError,
    );
  });
});
