/**
 * Minimal Telegram Bot API types — only the fields this bot actually reads. Not a general
 * Telegram SDK (MASTER_PROMPT-adjacent Phase 4 §22: "do not build a complete Telegram SDK").
 *
 * Every field here is attacker-controlled (MASTER_PROMPT §18/§24 analog: "treat all Telegram
 * user input as attacker-controlled") — this package never trusts `username`, `first_name`,
 * or `last_name` as an identity; only the numeric `id` is ever used that way.
 */

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

/** A narrow, structural runtime check — not full schema validation, just enough to reject
 *  something that clearly isn't a Telegram update before any field is trusted. */
export function isTelegramUpdate(value: unknown): value is TelegramUpdate {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.update_id !== "number" || !Number.isFinite(record.update_id)) return false;
  if (record.message !== undefined && !isTelegramMessage(record.message)) return false;
  if (record.callback_query !== undefined && !isTelegramCallbackQuery(record.callback_query)) {
    return false;
  }
  return true;
}

function isTelegramUser(value: unknown): value is TelegramUser {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as Record<string, unknown>).id === "number";
}

function isTelegramMessage(value: unknown): value is TelegramMessage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.message_id !== "number") return false;
  if (typeof record.chat !== "object" || record.chat === null) return false;
  if (typeof (record.chat as Record<string, unknown>).id !== "number") return false;
  if (record.from !== undefined && !isTelegramUser(record.from)) return false;
  if (record.text !== undefined && typeof record.text !== "string") return false;
  return true;
}

function isTelegramCallbackQuery(value: unknown): value is TelegramCallbackQuery {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") return false;
  if (!isTelegramUser(record.from)) return false;
  if (record.data !== undefined && typeof record.data !== "string") return false;
  if (record.message !== undefined && !isTelegramMessage(record.message)) return false;
  return true;
}
