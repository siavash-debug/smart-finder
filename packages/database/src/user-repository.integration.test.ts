import { afterAll, describe, expect, it } from "vitest";

import {
  createUser,
  findOrCreateUserByTelegramId,
  findUserById,
  findUserByTelegramId,
} from "./user-repository.js";
import {
  closeTestPool,
  deleteTestUser,
  getTestPool,
  isTestDatabaseAvailable,
  randomTelegramUserId,
} from "./test-support/db.js";

const available = await isTestDatabaseAvailable();

describe("user repository (integration)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it.runIf(available)("creates a user and finds it by id and by telegram id", async () => {
    const pool = getTestPool();
    const telegramUserId = randomTelegramUserId();

    const created = await createUser(pool, {
      telegramUserId,
      telegramUsername: "sia_test",
      displayName: "Sia",
    });

    expect(created.telegram_user_id).toBe(telegramUserId);

    const byId = await findUserById(pool, created.id);
    const byTelegramId = await findUserByTelegramId(pool, telegramUserId);

    expect(byId?.id).toBe(created.id);
    expect(byTelegramId?.id).toBe(created.id);

    await deleteTestUser(created.id);
  });

  it.runIf(available)("findUserById returns null for a nonexistent id", async () => {
    const pool = getTestPool();
    const missing = await findUserById(pool, "00000000-0000-0000-0000-000000000000");
    expect(missing).toBeNull();
  });

  it.runIf(available)("rejects a second user with the same telegram id", async () => {
    const pool = getTestPool();
    const telegramUserId = randomTelegramUserId();
    const first = await createUser(pool, { telegramUserId });

    await expect(createUser(pool, { telegramUserId })).rejects.toThrow(/duplicate key|unique/i);

    await deleteTestUser(first.id);
  });

  describe("findOrCreateUserByTelegramId", () => {
    it.runIf(available)("creates a user on first sight", async () => {
      const pool = getTestPool();
      const telegramUserId = randomTelegramUserId();

      const user = await findOrCreateUserByTelegramId(pool, {
        telegramUserId,
        displayName: "First Login",
      });

      expect(user.display_name).toBe("First Login");
      await deleteTestUser(user.id);
    });

    it.runIf(available)("returns the same user on a second login, same id", async () => {
      const pool = getTestPool();
      const telegramUserId = randomTelegramUserId();

      const first = await findOrCreateUserByTelegramId(pool, { telegramUserId });
      const second = await findOrCreateUserByTelegramId(pool, { telegramUserId });

      expect(second.id).toBe(first.id);
      await deleteTestUser(first.id);
    });

    it.runIf(available)(
      "fills in a username on a later login without blanking an existing one",
      async () => {
        const pool = getTestPool();
        const telegramUserId = randomTelegramUserId();

        await findOrCreateUserByTelegramId(pool, {
          telegramUserId,
          telegramUsername: "original_name",
        });
        // Telegram omits the username field when it is unset for that login attempt — this
        // must not overwrite the name captured on a previous login.
        const second = await findOrCreateUserByTelegramId(pool, { telegramUserId });

        expect(second.telegram_username).toBe("original_name");
        await deleteTestUser(second.id);
      },
    );
  });
});
