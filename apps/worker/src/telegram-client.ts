import { TelegramClient } from "@smart-finder/telegram";

import type { WorkerEnv } from "@smart-finder/shared";

export function createWorkerTelegramClient(env: WorkerEnv): TelegramClient {
  return new TelegramClient({ botToken: env.TELEGRAM_BOT_TOKEN });
}
