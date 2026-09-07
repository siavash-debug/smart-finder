/**
 * Telegram bot integration (MASTER_PROMPT-adjacent Phase 4). Pure — no database dependency;
 * `apps/web` (webhook) and `apps/worker` (notification delivery) compose this with
 * `@smart-finder/database` and `@smart-finder/normalizer`.
 */

export {
  TelegramClient,
  TelegramApiError,
  type AnswerCallbackQueryOptions,
  type InlineKeyboardButton,
  type SendMessageOptions,
  type TelegramApiErrorKind,
  type TelegramClientOptions,
  type TelegramFetch,
} from "./client.js";

export { verifyWebhookSecret } from "./webhook-secret.js";

export {
  isTelegramUpdate,
  type TelegramCallbackQuery,
  type TelegramChat,
  type TelegramMessage,
  type TelegramUpdate,
  type TelegramUser,
} from "./types.js";

export { parseInput, type CommandName, type ParsedInput } from "./commands.js";

export {
  CALLBACK_CONFIRM,
  CALLBACK_EDIT,
  helpMessage,
  invalidCallbackMessage,
  preferenceConfirmedMessage,
  preferenceEditPromptMessage,
  preferenceSummaryMessage,
  rateLimitedMessage,
  statusMessage,
  unknownCommandMessage,
  welcomeMessage,
  type PreferenceSummaryLines,
  type StatusSummary,
} from "./messages.js";

export {
  checkRateLimit,
  COMMAND_RATE_LIMIT,
  NOTIFICATION_RATE_LIMIT,
  type RateLimitDecision,
  type RateLimitPolicy,
} from "./rate-limit.js";

export { isWithinQuietHours, nextAllowedSendTime } from "./quiet-hours.js";
