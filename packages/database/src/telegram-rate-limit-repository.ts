/**
 * `telegram_command_log` repository (migration `0003_telegram_rate_limit.sql`, Phase 4). The
 * sole purpose of this table: let the webhook decide whether a Telegram user is sending
 * commands too fast. See `@smart-finder/telegram`'s `rate-limit.ts` for the pure
 * decision logic this data feeds.
 */

import type { Queryable } from "./pool.js";

export async function recordTelegramCommand(
  pool: Queryable,
  telegramUserId: bigint,
  command: string,
): Promise<void> {
  await pool.query("INSERT INTO telegram_command_log (telegram_user_id, command) VALUES ($1, $2)", [
    telegramUserId,
    command,
  ]);
}

/** Timestamps of this Telegram user's recent commands, newest first, bounded by `since`. */
export async function getRecentCommandTimestamps(
  pool: Queryable,
  telegramUserId: bigint,
  since: Date,
): Promise<Date[]> {
  const { rows } = await pool.query<{ created_at: Date }>(
    `SELECT created_at FROM telegram_command_log
     WHERE telegram_user_id = $1 AND created_at >= $2
     ORDER BY created_at DESC`,
    [telegramUserId, since],
  );
  return rows.map((r) => r.created_at);
}
