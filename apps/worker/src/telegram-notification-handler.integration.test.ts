/**
 * Integration tests for the `send_telegram_notification` job handler against a real
 * PostgreSQL instance. The Telegram side is faked (an injected `fetchImpl`) — this phase
 * documents that live Telegram delivery is not exercised here (MASTER_PROMPT-adjacent Phase 4
 * §25). Skips itself when no database is reachable.
 */

import { afterAll, describe, expect, it } from "vitest";

import {
  claimJobs,
  createNotification,
  createUser,
  enqueueJob,
  getJobById,
  getNotificationById,
} from "@smart-finder/database";
import { createLogger, type LogRecord } from "@smart-finder/shared";
import { TelegramClient, type TelegramFetch } from "@smart-finder/telegram";
// Reach into packages/database's test-support directly — this test needs a real pool the
// same way packages/database's own integration tests do.
import {
  closeTestPool,
  deleteTestUser,
  getTestPool,
  isTestDatabaseAvailable,
  randomTelegramUserId,
} from "../../../packages/database/src/test-support/db.js";

import { createSendTelegramNotificationHandler } from "./telegram-notification-handler.js";

const available = await isTestDatabaseAvailable();

function uniqueKey(label: string): string {
  return `test:${label}:${Date.now().toString()}:${Math.random().toString(36).slice(2)}`;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function silentLogger(records: LogRecord[] = []) {
  return createLogger({ level: "trace", sink: (record) => records.push(record) });
}

// A daytime UTC instant that is NOT quiet hours in Tehran (12:00 UTC = 15:30 Tehran).
const DAYTIME = new Date("2026-09-07T12:00:00.000Z");
// 2026-09-07T20:00Z = Tehran 23:30 — inside quiet hours.
const QUIET_TIME = new Date("2026-09-07T20:00:00.000Z");

describe("send_telegram_notification handler (integration)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it.runIf(available)("sends successfully and marks the notification sent", async () => {
    const pool = getTestPool();
    const user = await createUser(pool, { telegramUserId: randomTelegramUserId() });
    const notification = await createNotification(pool, {
      userId: user.id,
      template: "telegram_welcome",
      idempotencyKey: uniqueKey("success"),
    });
    const fetchImpl: TelegramFetch = () => Promise.resolve(jsonResponse(200, { ok: true }));
    const handler = createSendTelegramNotificationHandler({
      pool,
      telegramClient: new TelegramClient({ botToken: "1:test", fetchImpl }),
      now: () => DAYTIME,
    });

    await handler({ notificationId: notification.id }, { logger: silentLogger(), runId: "r1" });

    const final = await getNotificationById(pool, notification.id);
    expect(final?.status).toBe("sent");
    expect(final?.sent_at).not.toBeNull();

    await deleteTestUser(user.id);
  });

  it.runIf(available)("throws on a transient failure so the job queue retries", async () => {
    const pool = getTestPool();
    const user = await createUser(pool, { telegramUserId: randomTelegramUserId() });
    const notification = await createNotification(pool, {
      userId: user.id,
      template: "telegram_welcome",
      idempotencyKey: uniqueKey("transient"),
    });
    const fetchImpl: TelegramFetch = () =>
      Promise.resolve(jsonResponse(500, { ok: false, description: "Internal Server Error" }));
    const handler = createSendTelegramNotificationHandler({
      pool,
      telegramClient: new TelegramClient({ botToken: "1:test", fetchImpl }),
      now: () => DAYTIME,
    });

    await expect(
      handler({ notificationId: notification.id }, { logger: silentLogger(), runId: "r1" }),
    ).rejects.toThrow();

    const afterAttempt = await getNotificationById(pool, notification.id);
    expect(afterAttempt?.status).toBe("pending"); // still pending — the job queue will retry
    expect(afterAttempt?.attempts).toBe(1);
    expect(afterAttempt?.last_error).toContain("Internal Server Error");

    await deleteTestUser(user.id);
  });

  it.runIf(available)("terminally fails on a permanent error without throwing", async () => {
    const pool = getTestPool();
    const user = await createUser(pool, { telegramUserId: randomTelegramUserId() });
    const notification = await createNotification(pool, {
      userId: user.id,
      template: "telegram_welcome",
      idempotencyKey: uniqueKey("permanent"),
    });
    const fetchImpl: TelegramFetch = () =>
      Promise.resolve(
        jsonResponse(403, { ok: false, description: "Forbidden: bot was blocked by the user" }),
      );
    const handler = createSendTelegramNotificationHandler({
      pool,
      telegramClient: new TelegramClient({ botToken: "1:test", fetchImpl }),
      now: () => DAYTIME,
    });

    await expect(
      handler({ notificationId: notification.id }, { logger: silentLogger(), runId: "r1" }),
    ).resolves.toBeUndefined();

    const final = await getNotificationById(pool, notification.id);
    expect(final?.status).toBe("failed");
    expect(final?.last_error).toContain("blocked");

    await deleteTestUser(user.id);
  });

  it.runIf(available)("is idempotent: a notification already sent is not sent twice", async () => {
    const pool = getTestPool();
    const user = await createUser(pool, { telegramUserId: randomTelegramUserId() });
    const notification = await createNotification(pool, {
      userId: user.id,
      template: "telegram_welcome",
      idempotencyKey: uniqueKey("dup-guard"),
    });
    let callCount = 0;
    const fetchImpl: TelegramFetch = () => {
      callCount += 1;
      return Promise.resolve(jsonResponse(200, { ok: true }));
    };
    const handler = createSendTelegramNotificationHandler({
      pool,
      telegramClient: new TelegramClient({ botToken: "1:test", fetchImpl }),
      now: () => DAYTIME,
    });

    await handler({ notificationId: notification.id }, { logger: silentLogger(), runId: "r1" });
    await handler({ notificationId: notification.id }, { logger: silentLogger(), runId: "r2" }); // simulated duplicate job

    expect(callCount).toBe(1); // second call was a no-op, no duplicate Telegram delivery

    await deleteTestUser(user.id);
  });

  it.runIf(available)(
    "defers during quiet hours instead of sending, and schedules a follow-up job",
    async () => {
      const pool = getTestPool();
      const user = await createUser(pool, { telegramUserId: randomTelegramUserId() });
      const notification = await createNotification(pool, {
        userId: user.id,
        template: "telegram_welcome",
        idempotencyKey: uniqueKey("quiet-hours"),
      });
      let telegramCalled = false;
      const fetchImpl: TelegramFetch = () => {
        telegramCalled = true;
        return Promise.resolve(jsonResponse(200, { ok: true }));
      };
      const handler = createSendTelegramNotificationHandler({
        pool,
        telegramClient: new TelegramClient({ botToken: "1:test", fetchImpl }),
        now: () => QUIET_TIME,
      });

      await handler({ notificationId: notification.id }, { logger: silentLogger(), runId: "r1" });

      expect(telegramCalled).toBe(false);
      const afterDefer = await getNotificationById(pool, notification.id);
      expect(afterDefer?.status).toBe("pending");
      expect(afterDefer?.scheduled_for.getTime()).toBeGreaterThan(QUIET_TIME.getTime());

      await deleteTestUser(user.id);
    },
  );

  it.runIf(available)("does not crash on an unknown notification id", async () => {
    const pool = getTestPool();
    const handler = createSendTelegramNotificationHandler({
      pool,
      telegramClient: new TelegramClient({
        botToken: "1:test",
        fetchImpl: () => Promise.resolve(jsonResponse(200, { ok: true })),
      }),
      now: () => DAYTIME,
    });

    await expect(
      handler(
        { notificationId: "00000000-0000-0000-0000-000000000000" },
        { logger: silentLogger(), runId: "r1" },
      ),
    ).resolves.toBeUndefined();
  });

  it.runIf(available)("rejects a malformed job payload", async () => {
    const pool = getTestPool();
    const handler = createSendTelegramNotificationHandler({
      pool,
      telegramClient: new TelegramClient({
        botToken: "1:test",
        fetchImpl: () => Promise.resolve(jsonResponse(200, { ok: true })),
      }),
      now: () => DAYTIME,
    });

    await expect(handler({}, { logger: silentLogger(), runId: "r1" })).rejects.toThrow(
      /notificationId/,
    );
  });

  it.runIf(available)(
    "end-to-end via the real job queue: enqueue, claim, handle, complete",
    async () => {
      const pool = getTestPool();
      const user = await createUser(pool, { telegramUserId: randomTelegramUserId() });
      const notification = await createNotification(pool, {
        userId: user.id,
        template: "telegram_welcome",
        idempotencyKey: uniqueKey("e2e"),
      });
      const job = await enqueueJob(pool, {
        jobType: "send_telegram_notification",
        payload: { notificationId: notification.id },
      });
      const handler = createSendTelegramNotificationHandler({
        pool,
        telegramClient: new TelegramClient({
          botToken: "1:test",
          fetchImpl: () => Promise.resolve(jsonResponse(200, { ok: true })),
        }),
        now: () => DAYTIME,
      });

      const [claimed] = await claimJobs(pool, { batchSize: 1, workerId: "test-worker" });
      expect(claimed?.id).toBe(job.id);

      await handler(claimed!.payload, { logger: silentLogger(), runId: "r1" });

      const finalNotification = await getNotificationById(pool, notification.id);
      expect(finalNotification?.status).toBe("sent");
      // The handler itself does not complete the job — that's job-dispatcher.ts's job in
      // production; here we only verify the handler's own effect on the notification.
      const jobRow = await getJobById(pool, job.id);
      expect(jobRow?.status).toBe("processing");

      await deleteTestUser(user.id);
    },
  );
});
