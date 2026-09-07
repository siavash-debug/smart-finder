/**
 * HTTP-level tests for the webhook route: the three checks that must reject *before* any
 * database or Telegram work happens. `handleTelegramUpdate` itself is covered exhaustively by
 * `../../../lib/telegram/handle-update.integration.test.ts` — these tests only verify the
 * route's own request-validation layer (secret check, JSON parsing, update-shape check),
 * which is why none of them need a live database: all three rejection paths return before
 * `getPool()` is ever called.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://smartfinder:smartfinder@localhost:5432/smartfinder",
  TELEGRAM_BOT_TOKEN: "123456789:route-test-not-a-real-token-XYZ123",
  TELEGRAM_WEBHOOK_SECRET: "route-test-webhook-secret",
};

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/telegram/webhook", () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(REQUIRED_ENV)) vi.stubEnv(key, value);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a request with no secret header, before touching the database", async () => {
    const { POST } = await import("./route.js");
    const response = await POST(request({ update_id: 1 }));

    expect(response.status).toBe(401);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "unauthorized" });
  });

  it("rejects a request with the wrong secret", async () => {
    const { POST } = await import("./route.js");
    const response = await POST(
      request({ update_id: 1 }, { "x-telegram-bot-api-secret-token": "wrong-secret" }),
    );

    expect(response.status).toBe(401);
  });

  it("never echoes the expected secret back in the rejection response", async () => {
    const { POST } = await import("./route.js");
    const response = await POST(
      request({ update_id: 1 }, { "x-telegram-bot-api-secret-token": "wrong-secret" }),
    );

    const text = await response.text();
    expect(text).not.toContain(REQUIRED_ENV.TELEGRAM_WEBHOOK_SECRET);
  });

  it("rejects malformed JSON even with a correct secret", async () => {
    const { POST } = await import("./route.js");
    const response = await POST(
      request("{ not valid json", {
        "x-telegram-bot-api-secret-token": REQUIRED_ENV.TELEGRAM_WEBHOOK_SECRET,
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects a well-formed JSON body that isn't a Telegram update", async () => {
    const { POST } = await import("./route.js");
    const response = await POST(
      request(
        { not: "a telegram update" },
        { "x-telegram-bot-api-secret-token": REQUIRED_ENV.TELEGRAM_WEBHOOK_SECRET },
      ),
    );

    expect(response.status).toBe(400);
  });

  it("rejects an update with a malformed nested field rather than crashing", async () => {
    const { POST } = await import("./route.js");
    const response = await POST(
      request(
        { update_id: 1, message: { message_id: 1, chat: { id: "not-a-number" } } },
        { "x-telegram-bot-api-secret-token": REQUIRED_ENV.TELEGRAM_WEBHOOK_SECRET },
      ),
    );

    expect(response.status).toBe(400);
  });
});
