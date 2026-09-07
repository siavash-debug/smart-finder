import { afterAll, describe, expect, it } from "vitest";

import {
  getRecentCommandTimestamps,
  recordTelegramCommand,
} from "./telegram-rate-limit-repository.js";
import { closeTestPool, getTestPool, isTestDatabaseAvailable } from "./test-support/db.js";

const available = await isTestDatabaseAvailable();

function randomTelegramId(): bigint {
  return BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000));
}

describe("telegram rate-limit repository (integration)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it.runIf(available)("records a command and retrieves it", async () => {
    const pool = getTestPool();
    const telegramUserId = randomTelegramId();
    const since = new Date(Date.now() - 60_000);

    await recordTelegramCommand(pool, telegramUserId, "start");
    const timestamps = await getRecentCommandTimestamps(pool, telegramUserId, since);

    expect(timestamps).toHaveLength(1);
  });

  it.runIf(available)("only returns commands for the given telegram user id", async () => {
    const pool = getTestPool();
    const userA = randomTelegramId();
    const userB = randomTelegramId();
    const since = new Date(Date.now() - 60_000);

    await recordTelegramCommand(pool, userA, "start");
    await recordTelegramCommand(pool, userA, "help");
    await recordTelegramCommand(pool, userB, "start");

    const forA = await getRecentCommandTimestamps(pool, userA, since);
    const forB = await getRecentCommandTimestamps(pool, userB, since);

    expect(forA).toHaveLength(2);
    expect(forB).toHaveLength(1);
  });

  it.runIf(available)("does not return commands older than since", async () => {
    const pool = getTestPool();
    const telegramUserId = randomTelegramId();
    await recordTelegramCommand(pool, telegramUserId, "start");

    const farFuture = new Date(Date.now() + 60_000);
    const timestamps = await getRecentCommandTimestamps(pool, telegramUserId, farFuture);

    expect(timestamps).toHaveLength(0);
  });

  it.runIf(available)("returns timestamps newest first", async () => {
    const pool = getTestPool();
    const telegramUserId = randomTelegramId();
    const since = new Date(Date.now() - 60_000);

    await recordTelegramCommand(pool, telegramUserId, "start");
    await recordTelegramCommand(pool, telegramUserId, "help");
    await recordTelegramCommand(pool, telegramUserId, "status");

    const timestamps = await getRecentCommandTimestamps(pool, telegramUserId, since);

    expect(timestamps).toHaveLength(3);
    for (let i = 1; i < timestamps.length; i += 1) {
      expect(timestamps[i - 1]!.getTime()).toBeGreaterThanOrEqual(timestamps[i]!.getTime());
    }
  });
});
