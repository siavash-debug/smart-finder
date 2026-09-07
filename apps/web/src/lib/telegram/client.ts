import "server-only";

import { loadWebEnv } from "@smart-finder/shared";
import { TelegramClient } from "@smart-finder/telegram";

/** One client per process, same reasoning as `lib/db.ts`'s pooled connection: avoid
 *  re-reading env / re-constructing on every hot reload in development. */
const globalForClient = globalThis as typeof globalThis & {
  __smartFinderTelegramClient?: TelegramClient;
};

export function getTelegramClient(): TelegramClient {
  globalForClient.__smartFinderTelegramClient ??= new TelegramClient({
    botToken: loadWebEnv().TELEGRAM_BOT_TOKEN,
  });
  return globalForClient.__smartFinderTelegramClient;
}
