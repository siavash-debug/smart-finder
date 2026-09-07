/**
 * Integration tests for the `notification` repository against a real PostgreSQL instance.
 * Skips itself when no database is reachable — see `test-support/db.ts`.
 */

import { afterAll, describe, expect, it } from "vitest";

import {
  countNotificationsByStatus,
  countNotificationsForUserSince,
  createNotification,
  getNotificationById,
  getNotificationByIdempotencyKey,
  markNotificationFailed,
  markNotificationSent,
  markNotificationSuppressed,
  recordNotificationAttemptFailure,
  rescheduleNotification,
} from "./notification-repository.js";
import { createUser } from "./user-repository.js";
import {
  closeTestPool,
  deleteTestUser,
  getTestPool,
  isTestDatabaseAvailable,
  randomTelegramUserId,
} from "./test-support/db.js";

const available = await isTestDatabaseAvailable();

async function createTestUser() {
  return createUser(getTestPool(), { telegramUserId: randomTelegramUserId() });
}

function uniqueKey(label: string): string {
  return `test:${label}:${Date.now().toString()}:${Math.random().toString(36).slice(2)}`;
}

describe("notification repository (integration)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it.runIf(available)("creates a pending notification with documented defaults", async () => {
    const pool = getTestPool();
    const user = await createTestUser();

    const notification = await createNotification(pool, {
      userId: user.id,
      template: "telegram_welcome",
      idempotencyKey: uniqueKey("create-defaults"),
    });

    expect(notification).toMatchObject({
      user_id: user.id,
      channel: "telegram",
      template: "telegram_welcome",
      status: "pending",
      attempts: 0,
      payload: {},
    });
    expect(notification.match_id).toBeNull();
    expect(notification.posting_id).toBeNull();

    await deleteTestUser(user.id);
  });

  it.runIf(available)(
    "is idempotent: creating twice with the same key returns the same row",
    async () => {
      const pool = getTestPool();
      const user = await createTestUser();
      const idempotencyKey = uniqueKey("idempotent");

      const first = await createNotification(pool, {
        userId: user.id,
        template: "telegram_match_alert",
        idempotencyKey,
        payload: { attempt: 1 },
      });
      const second = await createNotification(pool, {
        userId: user.id,
        template: "telegram_match_alert",
        idempotencyKey,
        payload: { attempt: 2 }, // different payload — must be ignored; the original row wins
      });

      expect(second.id).toBe(first.id);
      expect(second.payload).toEqual({ attempt: 1 });

      await deleteTestUser(user.id);
    },
  );

  it.runIf(available)("concurrent creation with the same key never produces two rows", async () => {
    const pool = getTestPool();
    const user = await createTestUser();
    const idempotencyKey = uniqueKey("concurrent");

    const [a, b] = await Promise.all([
      createNotification(pool, { userId: user.id, template: "t", idempotencyKey }),
      createNotification(pool, { userId: user.id, template: "t", idempotencyKey }),
    ]);

    expect(a.id).toBe(b.id);

    await deleteTestUser(user.id);
  });

  it.runIf(available)("markNotificationSent transitions pending to sent exactly once", async () => {
    const pool = getTestPool();
    const user = await createTestUser();
    const notification = await createNotification(pool, {
      userId: user.id,
      template: "t",
      idempotencyKey: uniqueKey("sent"),
    });

    const firstCall = await markNotificationSent(pool, notification.id);
    const secondCall = await markNotificationSent(pool, notification.id); // already sent

    const final = await getNotificationById(pool, notification.id);

    expect(firstCall).toBe(true);
    expect(secondCall).toBe(false); // duplicate delivery prevented
    expect(final?.status).toBe("sent");
    expect(final?.sent_at).not.toBeNull();
    expect(final?.attempts).toBe(1);

    await deleteTestUser(user.id);
  });

  it.runIf(available)(
    "markNotificationFailed transitions pending to failed (terminal)",
    async () => {
      const pool = getTestPool();
      const user = await createTestUser();
      const notification = await createNotification(pool, {
        userId: user.id,
        template: "t",
        idempotencyKey: uniqueKey("failed"),
      });

      const didFail = await markNotificationFailed(pool, notification.id, "permanent: blocked");
      const final = await getNotificationById(pool, notification.id);

      expect(didFail).toBe(true);
      expect(final?.status).toBe("failed");
      expect(final?.last_error).toBe("permanent: blocked");

      await deleteTestUser(user.id);
    },
  );

  it.runIf(available)(
    "recordNotificationAttemptFailure keeps the notification pending (retry path)",
    async () => {
      const pool = getTestPool();
      const user = await createTestUser();
      const notification = await createNotification(pool, {
        userId: user.id,
        template: "t",
        idempotencyKey: uniqueKey("retry"),
      });

      await recordNotificationAttemptFailure(pool, notification.id, "transient: timeout");
      const afterOne = await getNotificationById(pool, notification.id);

      expect(afterOne?.status).toBe("pending");
      expect(afterOne?.attempts).toBe(1);
      expect(afterOne?.last_error).toBe("transient: timeout");

      await deleteTestUser(user.id);
    },
  );

  it.runIf(available)("markNotificationSuppressed transitions pending to suppressed", async () => {
    const pool = getTestPool();
    const user = await createTestUser();
    const notification = await createNotification(pool, {
      userId: user.id,
      template: "t",
      idempotencyKey: uniqueKey("suppressed"),
    });

    const didSuppress = await markNotificationSuppressed(pool, notification.id, "rate_limited");
    const final = await getNotificationById(pool, notification.id);

    expect(didSuppress).toBe(true);
    expect(final?.status).toBe("suppressed");
    expect(final?.last_error).toBe("rate_limited");

    await deleteTestUser(user.id);
  });

  it.runIf(available)(
    "rescheduleNotification moves scheduled_for without changing status",
    async () => {
      const pool = getTestPool();
      const user = await createTestUser();
      const notification = await createNotification(pool, {
        userId: user.id,
        template: "t",
        idempotencyKey: uniqueKey("reschedule"),
      });
      const newTime = new Date(Date.now() + 3_600_000);

      const didReschedule = await rescheduleNotification(pool, notification.id, newTime);
      const final = await getNotificationById(pool, notification.id);

      expect(didReschedule).toBe(true);
      expect(final?.status).toBe("pending");
      expect(final?.scheduled_for.getTime()).toBe(newTime.getTime());

      await deleteTestUser(user.id);
    },
  );

  it.runIf(available)(
    "a terminal notification cannot be sent, failed, suppressed, or rescheduled again",
    async () => {
      const pool = getTestPool();
      const user = await createTestUser();
      const notification = await createNotification(pool, {
        userId: user.id,
        template: "t",
        idempotencyKey: uniqueKey("terminal-guard"),
      });
      await markNotificationSent(pool, notification.id);

      expect(await markNotificationFailed(pool, notification.id, "x")).toBe(false);
      expect(await markNotificationSuppressed(pool, notification.id, "x")).toBe(false);
      expect(await rescheduleNotification(pool, notification.id, new Date())).toBe(false);

      await deleteTestUser(user.id);
    },
  );

  it.runIf(available)("getNotificationByIdempotencyKey finds the right row", async () => {
    const pool = getTestPool();
    const user = await createTestUser();
    const idempotencyKey = uniqueKey("lookup");
    const created = await createNotification(pool, {
      userId: user.id,
      template: "t",
      idempotencyKey,
    });

    const found = await getNotificationByIdempotencyKey(pool, idempotencyKey);

    expect(found?.id).toBe(created.id);

    await deleteTestUser(user.id);
  });

  it.runIf(available)(
    "countNotificationsForUserSince only counts this user's recent rows",
    async () => {
      const pool = getTestPool();
      const userA = await createTestUser();
      const userB = await createTestUser();
      const since = new Date(Date.now() - 60_000);

      await createNotification(pool, {
        userId: userA.id,
        template: "t",
        idempotencyKey: uniqueKey("count-a1"),
      });
      await createNotification(pool, {
        userId: userA.id,
        template: "t",
        idempotencyKey: uniqueKey("count-a2"),
      });
      await createNotification(pool, {
        userId: userB.id,
        template: "t",
        idempotencyKey: uniqueKey("count-b1"),
      });

      const countA = await countNotificationsForUserSince(pool, userA.id, since);
      const countB = await countNotificationsForUserSince(pool, userB.id, since);

      expect(countA).toBe(2);
      expect(countB).toBe(1);

      await deleteTestUser(userA.id);
      await deleteTestUser(userB.id);
    },
  );

  it.runIf(available)("countNotificationsByStatus reflects transitions", async () => {
    const pool = getTestPool();
    const user = await createTestUser();
    const before = await countNotificationsByStatus(pool, "sent");
    const notification = await createNotification(pool, {
      userId: user.id,
      template: "t",
      idempotencyKey: uniqueKey("count-status"),
    });
    await markNotificationSent(pool, notification.id);

    const after = await countNotificationsByStatus(pool, "sent");
    expect(after).toBe(before + 1);

    await deleteTestUser(user.id);
  });
});
