import "server-only";

import {
  extractPreferences,
  type AreaConstraint,
  type AttributePreference,
  type ExtractedPreferences,
  type PriceConstraint,
} from "@smart-finder/normalizer";
import {
  findOrCreateUserByTelegramId,
  getActiveSearchProfile,
  getRecentCommandTimestamps,
  recordTelegramCommand,
  replaceActiveSearchProfile,
  type DatabasePool,
} from "@smart-finder/database";
import type { Logger } from "@smart-finder/shared";
import {
  CALLBACK_CONFIRM,
  CALLBACK_EDIT,
  checkRateLimit,
  COMMAND_RATE_LIMIT,
  helpMessage,
  invalidCallbackMessage,
  parseInput,
  preferenceConfirmedMessage,
  preferenceEditPromptMessage,
  preferenceSummaryMessage,
  statusMessage,
  unknownCommandMessage,
  welcomeMessage,
  type TelegramCallbackQuery,
  type TelegramClient,
  type TelegramMessage,
  type TelegramUpdate,
} from "@smart-finder/telegram";

export interface HandleUpdateDeps {
  pool: DatabasePool;
  telegramClient: TelegramClient;
  logger: Logger;
  now: () => Date;
}

/**
 * The webhook's whole job in one function: identify the Telegram user, rate-limit, route to
 * a command/free-text/callback handler, reply. Kept separate from the Next.js route so it can
 * be exercised in tests without constructing a real `Request`.
 *
 * Every branch scopes its database work to the `app_user` resolved from *this update's own*
 * `from.id` — never a value the client could otherwise influence (MASTER_PROMPT-adjacent
 * Phase 4 §11: "do not accept arbitrary user IDs from clients").
 */
export async function handleTelegramUpdate(
  update: TelegramUpdate,
  deps: HandleUpdateDeps,
): Promise<void> {
  const { logger } = deps;

  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, deps);
    return;
  }

  if (update.message?.from === undefined || update.message.text === undefined) {
    // An update type this bot doesn't handle (e.g. a photo, a poll, an edited message with no
    // text). Acknowledged and ignored — not an error.
    logger.info("telegram_update_ignored", { status: "ignored" });
    return;
  }

  const message = update.message;
  const telegramUserId = BigInt(message.from!.id);

  const limited = await isRateLimited(deps.pool, telegramUserId, deps.now());
  if (limited) {
    logger.warn("telegram_rate_limited", { telegram_user_id: telegramUserId.toString() });
    return;
  }
  await recordTelegramCommand(deps.pool, telegramUserId, "message");

  const parsed = parseInput(message.text!);

  if (parsed.kind === "command") {
    await handleCommand(parsed.command, message, telegramUserId, deps);
    return;
  }
  if (parsed.kind === "unknown_command") {
    await deps.telegramClient.sendMessage({
      chatId: message.chat.id,
      text: unknownCommandMessage(),
    });
    return;
  }
  await handleFreeText(parsed.text, message, telegramUserId, deps);
}

async function isRateLimited(
  pool: DatabasePool,
  telegramUserId: bigint,
  now: Date,
): Promise<boolean> {
  const since = new Date(now.getTime() - COMMAND_RATE_LIMIT.windowMs);
  const timestamps = await getRecentCommandTimestamps(pool, telegramUserId, since);
  return checkRateLimit(timestamps, now, COMMAND_RATE_LIMIT).limited;
}

async function handleCommand(
  command: "start" | "help" | "status",
  message: TelegramMessage,
  telegramUserId: bigint,
  deps: HandleUpdateDeps,
): Promise<void> {
  const { pool, telegramClient, logger } = deps;
  const chatId = message.chat.id;

  if (command === "start") {
    // Idempotent by construction: findOrCreateUserByTelegramId is a single INSERT ... ON
    // CONFLICT (user-repository.ts), so calling /start repeatedly, or concurrently, never
    // creates a second app_user for the same Telegram identity.
    const user = await findOrCreateUserByTelegramId(pool, {
      telegramUserId,
      ...(message.from?.username !== undefined ? { telegramUsername: message.from.username } : {}),
      ...(message.from?.first_name !== undefined ? { displayName: message.from.first_name } : {}),
    });
    logger.info("telegram_user_linked", {
      user_id: user.id,
      telegram_user_id: telegramUserId.toString(),
    });
    await telegramClient.sendMessage({ chatId, text: welcomeMessage() });
    return;
  }

  if (command === "help") {
    await telegramClient.sendMessage({ chatId, text: helpMessage() });
    return;
  }

  // status
  const user = await findOrCreateUserByTelegramId(pool, { telegramUserId });
  const activeProfile = await getActiveSearchProfile(pool, user.id);
  await telegramClient.sendMessage({
    chatId,
    text: statusMessage({ hasActiveSearchProfile: activeProfile !== null }),
  });
}

async function handleFreeText(
  text: string,
  message: TelegramMessage,
  telegramUserId: bigint,
  deps: HandleUpdateDeps,
): Promise<void> {
  const { pool, telegramClient } = deps;
  const chatId = message.chat.id;

  if (text.trim() === "") return;

  // Deterministic only — no AI (MASTER_PROMPT-adjacent Phase 4 §12).
  const extracted = extractPreferences(text);
  const summary = buildSummaryLines(extracted);

  const hasExtractedFields = hasAnyExtractedField(summary);
  await telegramClient.sendMessage({
    chatId,
    text: preferenceSummaryMessage(summary),
    ...(hasExtractedFields
      ? {
          inlineKeyboard: [
            [
              { text: "تأیید", callback_data: CALLBACK_CONFIRM },
              { text: "ویرایش", callback_data: CALLBACK_EDIT },
            ],
          ],
        }
      : {}),
  });

  if (!hasExtractedFields) return;

  // Saved eagerly rather than held as a separate "draft" state — the schema has no draft
  // column, and Telegram's 64-byte callback_data limit cannot carry the extracted structure
  // back on confirm. replaceActiveSearchProfile already archives the previous active profile
  // to search_profile_history (Phase 1), so a later /ویرایش-triggered resend safely replaces
  // this without losing anything. See ADR-0015 for the full reasoning.
  const user = await findOrCreateUserByTelegramId(pool, { telegramUserId });
  // Built with conditional spreads, not `field: value ?? undefined`: under
  // `exactOptionalPropertyTypes`, an optional property must be entirely absent to mean "not
  // set" — explicitly assigning `undefined` to it is a type error, and would be a bug here
  // too (SearchProfileInput's own convention is "omitted means no preference", not
  // "present-but-undefined").
  const requireParking = attributeToTriState(extracted.parking);
  const requireElevator = attributeToTriState(extracted.elevator);

  await replaceActiveSearchProfile(pool, user.id, {
    transactionType: "sale",
    propertyType: "apartment",
    ...(extracted.price.min !== null ? { minPriceToman: extracted.price.min } : {}),
    ...(extracted.price.max !== null ? { maxPriceToman: extracted.price.max } : {}),
    ...(extracted.area.min !== null ? { minAreaSqm: extracted.area.min } : {}),
    ...(extracted.area.max !== null ? { maxAreaSqm: extracted.area.max } : {}),
    ...(extracted.bedrooms.min !== null ? { minRooms: extracted.bedrooms.min } : {}),
    ...(extracted.bedrooms.max !== null ? { maxRooms: extracted.bedrooms.max } : {}),
    ...(requireParking !== undefined ? { requireParking } : {}),
    ...(requireElevator !== undefined ? { requireElevator } : {}),
    rawQueryText: text,
    interpretationVersion: "phase4-normalizer-v1",
  });
}

function attributeToTriState(preference: AttributePreference): boolean | undefined {
  if (preference === "required") return true;
  if (preference === "forbidden") return false;
  return undefined; // "no_preference" and "unknown" both mean: don't set a requirement
}

function hasAnyExtractedField(summary: ReturnType<typeof buildSummaryLines>): boolean {
  return Object.values(summary).some((line) => line !== null);
}

function buildSummaryLines(extracted: ExtractedPreferences) {
  return {
    areaLine: formatRangeLine("متراژ", extracted.area, "متر"),
    bedroomsLine:
      extracted.bedrooms.min !== null
        ? `خواب: ${formatCount(extracted.bedrooms.min, extracted.bedrooms.max)}`
        : null,
    districtLine: extracted.district !== null ? `منطقه: ${extracted.district.canonicalName}` : null,
    priceLine: formatPriceLine(extracted.price),
    parkingLine: formatAttributeLine("پارکینگ", extracted.parking),
    elevatorLine: formatAttributeLine("آسانسور", extracted.elevator),
  };
}

function formatCount(min: number, max: number | null): string {
  return max !== null && max !== min ? `${String(min)} تا ${String(max)}` : String(min);
}

function formatRangeLine(label: string, range: AreaConstraint, unit: string): string | null {
  if (range.min === null && range.max === null) return null;
  if (range.min !== null && range.max !== null)
    return `${label}: ${String(range.min)} تا ${String(range.max)} ${unit}`;
  if (range.min !== null) return `${label}: حداقل ${String(range.min)} ${unit}`;
  return `${label}: حداکثر ${String(range.max)} ${unit}`;
}

function formatPriceLine(price: PriceConstraint): string | null {
  if (price.min === null && price.max === null) return null;
  const format = (v: bigint): string => v.toLocaleString("fa-IR");
  if (price.min !== null && price.max !== null)
    return `قیمت: ${format(price.min)} تا ${format(price.max)} تومان`;
  if (price.min !== null) return `قیمت: حداقل ${format(price.min)} تومان`;
  return `قیمت: حداکثر ${format(price.max!)} تومان`;
}

function formatAttributeLine(label: string, preference: AttributePreference): string | null {
  if (preference === "required") return `${label}: دارد`;
  if (preference === "forbidden") return `${label}: ندارد`;
  return null; // "no_preference" and "unknown" are not shown as a stated fact
}

async function handleCallbackQuery(
  callbackQuery: TelegramCallbackQuery,
  deps: HandleUpdateDeps,
): Promise<void> {
  const { pool, telegramClient, logger } = deps;
  const telegramUserId = BigInt(callbackQuery.from.id);
  const chatId = callbackQuery.message?.chat.id;

  await telegramClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id });

  if (chatId === undefined) return;

  // The callback data carries no profile/user reference at all (see handleFreeText's
  // comment) — every action here operates only on "the tapping user's own" state, resolved
  // fresh from callbackQuery.from.id, which Telegram itself authenticates. There is no
  // identifier in the payload an attacker could substitute to reach another user's data
  // (MASTER_PROMPT-adjacent Phase 4 §23).
  if (callbackQuery.data === CALLBACK_CONFIRM) {
    const user = await findOrCreateUserByTelegramId(pool, { telegramUserId });
    logger.info("telegram_preference_confirmed", { user_id: user.id });
    await telegramClient.sendMessage({ chatId, text: preferenceConfirmedMessage() });
    return;
  }
  if (callbackQuery.data === CALLBACK_EDIT) {
    await telegramClient.sendMessage({ chatId, text: preferenceEditPromptMessage() });
    return;
  }

  logger.warn("telegram_invalid_callback", { status: "rejected" });
  await telegramClient.sendMessage({ chatId, text: invalidCallbackMessage() });
}
