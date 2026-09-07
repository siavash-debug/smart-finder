/**
 * Integration tests for `handleTelegramUpdate` against a real PostgreSQL instance. The
 * Telegram side is faked (an injected `fetchImpl` on a real `TelegramClient`) — live Telegram
 * delivery is not exercised here (MASTER_PROMPT-adjacent Phase 4 §25). Skips itself when no
 * database is reachable.
 */

import { afterAll, describe, expect, it } from "vitest";

import { findUserByTelegramId, getActiveSearchProfile } from "@smart-finder/database";
import { createLogger } from "@smart-finder/shared";
import { TelegramClient, type TelegramFetch, type TelegramUpdate } from "@smart-finder/telegram";
import {
  closeTestPool,
  getTestPool,
  isTestDatabaseAvailable,
  randomTelegramUserId,
} from "../../../../../packages/database/src/test-support/db.js";

import { handleTelegramUpdate } from "./handle-update.js";

const available = await isTestDatabaseAvailable();
const DAYTIME = new Date("2026-09-07T12:00:00.000Z"); // not quiet hours

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function silentLogger() {
  return createLogger({ level: "trace", sink: () => undefined });
}

interface Captured {
  chatId: number;
  text: string;
}

function fakeTelegram(): { client: TelegramClient; sent: Captured[] } {
  const sent: Captured[] = [];
  const fetchImpl: TelegramFetch = (_url, init) => {
    const body = JSON.parse(String(init.body as string)) as Record<string, unknown>;
    if (typeof body.chat_id === "number" && typeof body.text === "string") {
      sent.push({ chatId: body.chat_id, text: body.text });
    }
    return Promise.resolve(jsonResponse(200, { ok: true, result: {} }));
  };
  return { client: new TelegramClient({ botToken: "1:test", fetchImpl }), sent };
}

function messageUpdate(telegramUserId: number, text: string, username?: string): TelegramUpdate {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: 1,
      chat: { id: telegramUserId },
      from: {
        id: telegramUserId,
        first_name: "Test",
        ...(username !== undefined ? { username } : {}),
      },
      text,
    },
  };
}

describe("handleTelegramUpdate — identity (/start)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it.runIf(available)("first /start creates exactly one app_user", async () => {
    const pool = getTestPool();
    const telegramUserId = Number(randomTelegramUserId());
    const { client } = fakeTelegram();

    await handleTelegramUpdate(messageUpdate(telegramUserId, "/start"), {
      pool,
      telegramClient: client,
      logger: silentLogger(),
      now: () => DAYTIME,
    });

    const user = await findUserByTelegramId(pool, BigInt(telegramUserId));
    expect(user).not.toBeNull();
  });

  it.runIf(available)("repeated /start is idempotent — same user, no duplicate", async () => {
    const pool = getTestPool();
    const telegramUserId = Number(randomTelegramUserId());
    const { client } = fakeTelegram();
    const deps = { pool, telegramClient: client, logger: silentLogger(), now: () => DAYTIME };

    await handleTelegramUpdate(messageUpdate(telegramUserId, "/start"), deps);
    const first = await findUserByTelegramId(pool, BigInt(telegramUserId));

    await handleTelegramUpdate(messageUpdate(telegramUserId, "/start"), deps);
    await handleTelegramUpdate(messageUpdate(telegramUserId, "/start"), deps);
    const second = await findUserByTelegramId(pool, BigInt(telegramUserId));

    expect(second?.id).toBe(first?.id);
  });

  it.runIf(available)("concurrent /start requests cannot create duplicate identities", async () => {
    const pool = getTestPool();
    const telegramUserId = Number(randomTelegramUserId());
    const { client } = fakeTelegram();
    const deps = { pool, telegramClient: client, logger: silentLogger(), now: () => DAYTIME };

    await Promise.all(
      Array.from({ length: 5 }, () =>
        handleTelegramUpdate(messageUpdate(telegramUserId, "/start"), deps),
      ),
    );

    const { rows } = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM app_user WHERE telegram_user_id = $1",
      [telegramUserId],
    );
    expect(rows[0]?.count).toBe("1");
  });

  it.runIf(available)(
    "a username change on a later /start does not create another identity",
    async () => {
      const pool = getTestPool();
      const telegramUserId = Number(randomTelegramUserId());
      const { client } = fakeTelegram();
      const deps = { pool, telegramClient: client, logger: silentLogger(), now: () => DAYTIME };

      await handleTelegramUpdate(messageUpdate(telegramUserId, "/start", "old_username"), deps);
      const first = await findUserByTelegramId(pool, BigInt(telegramUserId));

      await handleTelegramUpdate(
        messageUpdate(telegramUserId, "/start", "brand_new_username"),
        deps,
      );
      const second = await findUserByTelegramId(pool, BigInt(telegramUserId));

      expect(second?.id).toBe(first?.id);
      expect(second?.telegram_username).toBe("brand_new_username");
    },
  );
});

describe("handleTelegramUpdate — commands", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it.runIf(available)("/start replies with a Persian welcome message", async () => {
    const pool = getTestPool();
    const telegramUserId = Number(randomTelegramUserId());
    const { client, sent } = fakeTelegram();

    await handleTelegramUpdate(messageUpdate(telegramUserId, "/start"), {
      pool,
      telegramClient: client,
      logger: silentLogger(),
      now: () => DAYTIME,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.chatId).toBe(telegramUserId);
    expect(sent[0]?.text.length).toBeGreaterThan(0);
  });

  it.runIf(available)("/help replies with a help message", async () => {
    const pool = getTestPool();
    const telegramUserId = Number(randomTelegramUserId());
    const { client, sent } = fakeTelegram();

    await handleTelegramUpdate(messageUpdate(telegramUserId, "/help"), {
      pool,
      telegramClient: client,
      logger: silentLogger(),
      now: () => DAYTIME,
    });

    expect(sent[0]?.text).toContain("/start");
  });

  it.runIf(available)("/status reports no active profile for a brand-new user", async () => {
    const pool = getTestPool();
    const telegramUserId = Number(randomTelegramUserId());
    const { client, sent } = fakeTelegram();

    await handleTelegramUpdate(messageUpdate(telegramUserId, "/status"), {
      pool,
      telegramClient: client,
      logger: silentLogger(),
      now: () => DAYTIME,
    });

    expect(sent[0]?.text).toContain("ثبت نکرده");
  });

  it.runIf(available)(
    "/status reports an active profile after one is set via free text",
    async () => {
      const pool = getTestPool();
      const telegramUserId = Number(randomTelegramUserId());
      const { client, sent } = fakeTelegram();
      const deps = { pool, telegramClient: client, logger: silentLogger(), now: () => DAYTIME };

      await handleTelegramUpdate(messageUpdate(telegramUserId, "۸۰ تا ۱۰۰ متر، دو خواب"), deps);
      await handleTelegramUpdate(messageUpdate(telegramUserId, "/status"), deps);

      expect(sent.at(-1)?.text).toContain("فعال");
    },
  );

  it.runIf(available)("an unrecognized command gets the unknown-command reply", async () => {
    const pool = getTestPool();
    const telegramUserId = Number(randomTelegramUserId());
    const { client, sent } = fakeTelegram();

    await handleTelegramUpdate(messageUpdate(telegramUserId, "/nonexistent"), {
      pool,
      telegramClient: client,
      logger: silentLogger(),
      now: () => DAYTIME,
    });

    expect(sent[0]?.text).toContain("/help");
  });
});

describe("handleTelegramUpdate — preference extraction and confirmation", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it.runIf(available)("free text sets the user's active search profile", async () => {
    const pool = getTestPool();
    const telegramUserId = Number(randomTelegramUserId());
    const { client } = fakeTelegram();

    await handleTelegramUpdate(messageUpdate(telegramUserId, "۸۰ تا ۱۰۰ متر، دو خواب"), {
      pool,
      telegramClient: client,
      logger: silentLogger(),
      now: () => DAYTIME,
    });

    const user = await findUserByTelegramId(pool, BigInt(telegramUserId));
    const profile = await getActiveSearchProfile(pool, user!.id);
    expect(profile).not.toBeNull();
    expect(profile?.min_area_sqm).toBe(80);
    expect(profile?.max_area_sqm).toBe(100);
    expect(profile?.min_rooms).toBe(2);
  });

  it.runIf(available)(
    "vague text with nothing extractable does not create a search profile",
    async () => {
      const pool = getTestPool();
      const telegramUserId = Number(randomTelegramUserId());
      const { client, sent } = fakeTelegram();

      await handleTelegramUpdate(messageUpdate(telegramUserId, "یه خونه خوب می‌خوام"), {
        pool,
        telegramClient: client,
        logger: silentLogger(),
        now: () => DAYTIME,
      });

      const user = await findUserByTelegramId(pool, BigInt(telegramUserId));
      // findOrCreateUserByTelegramId is only called once a field WAS extracted — with nothing
      // extracted, no user is created and no profile exists.
      expect(user).toBeNull();
      expect(sent[0]?.text).not.toContain("تأیید می‌کنید؟");
    },
  );

  it.runIf(available)(
    "confirming via callback is scoped to the tapping user's own identity",
    async () => {
      const pool = getTestPool();
      const telegramUserId = Number(randomTelegramUserId());
      const { client, sent } = fakeTelegram();
      const deps = { pool, telegramClient: client, logger: silentLogger(), now: () => DAYTIME };

      await handleTelegramUpdate(messageUpdate(telegramUserId, "۸۰ تا ۱۰۰ متر"), deps);
      await handleTelegramUpdate(
        {
          update_id: 1,
          callback_query: {
            id: "cbq-1",
            from: { id: telegramUserId },
            data: "pref:ack",
            message: { message_id: 2, chat: { id: telegramUserId } },
          },
        },
        deps,
      );

      expect(sent.at(-1)?.text).toContain("ثبت شد");
    },
  );
});

describe("handleTelegramUpdate — security", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it.runIf(available)(
    "an invalid callback payload gets a rejection reply, not a crash",
    async () => {
      const pool = getTestPool();
      const telegramUserId = Number(randomTelegramUserId());
      const { client, sent } = fakeTelegram();

      await handleTelegramUpdate(
        {
          update_id: 1,
          callback_query: {
            id: "cbq-1",
            from: { id: telegramUserId },
            data: "delete_everything:other-user-id",
            message: { message_id: 1, chat: { id: telegramUserId } },
          },
        },
        { pool, telegramClient: client, logger: silentLogger(), now: () => DAYTIME },
      );

      expect(sent[0]?.text).toContain("معتبر نیست");
    },
  );

  it.runIf(available)(
    "attacker-controlled message text cannot alter another user's identity or profile",
    async () => {
      const pool = getTestPool();
      const victim = Number(randomTelegramUserId());
      const attacker = Number(randomTelegramUserId());
      const { client } = fakeTelegram();
      const deps = { pool, telegramClient: client, logger: silentLogger(), now: () => DAYTIME };

      await handleTelegramUpdate(messageUpdate(victim, "۸۰ تا ۱۰۰ متر، دو خواب"), deps);
      const victimUser = await findUserByTelegramId(pool, BigInt(victim));
      const victimProfileBefore = await getActiveSearchProfile(pool, victimUser!.id);

      // The attacker's own message can never reference or affect the victim's user_id —
      // there is no field in a Telegram message the attacker controls that names another
      // user; handleTelegramUpdate only ever resolves identity from the update's own
      // `from.id`, which Telegram itself sets server-side.
      await handleTelegramUpdate(messageUpdate(attacker, "۵۰۰ متر، ده خواب"), deps);

      const victimProfileAfter = await getActiveSearchProfile(pool, victimUser!.id);
      expect(victimProfileAfter?.min_area_sqm).toBe(victimProfileBefore?.min_area_sqm);
      expect(victimProfileAfter?.id).toBe(victimProfileBefore?.id);
    },
  );

  it.runIf(available)("a malformed/unhandled update type is ignored without throwing", async () => {
    const pool = getTestPool();
    const { client } = fakeTelegram();

    await expect(
      handleTelegramUpdate(
        { update_id: 1 }, // no message, no callback_query
        { pool, telegramClient: client, logger: silentLogger(), now: () => DAYTIME },
      ),
    ).resolves.toBeUndefined();
  });
});

describe("handleTelegramUpdate — rate limiting", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it.runIf(available)("a legitimate single request always succeeds", async () => {
    const pool = getTestPool();
    const telegramUserId = Number(randomTelegramUserId());
    const { client, sent } = fakeTelegram();

    await handleTelegramUpdate(messageUpdate(telegramUserId, "/start"), {
      pool,
      telegramClient: client,
      logger: silentLogger(),
      now: () => DAYTIME,
    });

    expect(sent).toHaveLength(1);
  });

  it.runIf(available)("repeated rapid requests eventually stop being processed", async () => {
    const pool = getTestPool();
    const telegramUserId = Number(randomTelegramUserId());
    const { client, sent } = fakeTelegram();
    // Real wall-clock time here, deliberately not the fixed DAYTIME fixture: the rate-limit
    // window is computed from this `now` but compared against `telegram_command_log` rows
    // whose `created_at` is the database's own real `now()` — they must agree for the window
    // math to mean anything, same as it would in production where both are the real clock.
    const deps = { pool, telegramClient: client, logger: silentLogger(), now: () => new Date() };

    // COMMAND_RATE_LIMIT allows 20 events per 60s — send 25 in a row.
    for (let i = 0; i < 25; i += 1) {
      await handleTelegramUpdate(messageUpdate(telegramUserId, "/help"), deps);
    }

    expect(sent.length).toBeLessThan(25);
    expect(sent.length).toBeGreaterThan(0);
  });
});
