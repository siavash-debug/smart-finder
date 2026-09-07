/**
 * A small, isolated Telegram Bot API client (MASTER_PROMPT-adjacent Phase 4 §22) — typed
 * methods for exactly the operations this bot needs (`sendMessage`, `answerCallbackQuery`),
 * not a general SDK. Every Bot API call in the application goes through this module; nothing
 * else calls `fetch` against `api.telegram.org` directly.
 *
 * The bot token lives only in the `Authorization`-equivalent URL segment of each request; it
 * is never logged, and every error this module raises has the token stripped out first.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";
const DEFAULT_TIMEOUT_MS = 8_000;

export type TelegramFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface TelegramClientOptions {
  botToken: string;
  timeoutMs?: number;
  /** Injectable for tests — never issues a real network call otherwise. */
  fetchImpl?: TelegramFetch;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface SendMessageOptions {
  chatId: number;
  text: string;
  /** One row per array entry. Kept minimal — this bot's keyboards are one or two buttons. */
  inlineKeyboard?: InlineKeyboardButton[][];
}

export interface AnswerCallbackQueryOptions {
  callbackQueryId: string;
  text?: string;
}

/**
 * Distinguishes failure classes the caller needs to react to differently
 * (MASTER_PROMPT-adjacent Phase 4 §20): `transient` is worth retrying (network error, 5xx,
 * 429), `permanent` is not (4xx other than 429 — e.g. the user blocked the bot, or the chat
 * no longer exists), `malformed_response` means Telegram's own response couldn't be parsed as
 * the documented shape.
 */
export type TelegramApiErrorKind = "transient" | "permanent" | "malformed_response";

export class TelegramApiError extends Error {
  public readonly kind: TelegramApiErrorKind;
  public readonly statusCode: number | undefined;

  constructor(message: string, kind: TelegramApiErrorKind, statusCode?: number) {
    super(message);
    this.name = "TelegramApiError";
    this.kind = kind;
    this.statusCode = statusCode;
  }
}

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
  error_code?: number;
}

export class TelegramClient {
  private readonly botToken: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: TelegramFetch;

  constructor(options: TelegramClientOptions) {
    this.botToken = options.botToken;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async sendMessage(options: SendMessageOptions): Promise<void> {
    const body: Record<string, unknown> = {
      chat_id: options.chatId,
      text: options.text,
      parse_mode: "HTML",
    };
    if (options.inlineKeyboard !== undefined) {
      body.reply_markup = { inline_keyboard: options.inlineKeyboard };
    }
    await this.call("sendMessage", body);
  }

  async answerCallbackQuery(options: AnswerCallbackQueryOptions): Promise<void> {
    await this.call("answerCallbackQuery", {
      callback_query_id: options.callbackQueryId,
      text: options.text,
    });
  }

  private async call(method: string, body: Record<string, unknown>): Promise<void> {
    const url = `${TELEGRAM_API_BASE}/bot${this.botToken}/${method}`;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      // Includes both an abort (timeout) and a network-level failure (DNS, connection reset)
      // — both are transient from the caller's point of view, and neither ever carries the
      // token: `error` here is a fetch/AbortError, not anything containing the request URL.
      throw new TelegramApiError(
        `Telegram API request failed: ${errorMessage(error)}`,
        "transient",
      );
    } finally {
      clearTimeout(timer);
    }

    let parsed: TelegramApiResponse;
    try {
      parsed = (await response.json()) as TelegramApiResponse;
    } catch {
      throw new TelegramApiError(
        `Telegram API returned a non-JSON response (status ${String(response.status)})`,
        "malformed_response",
        response.status,
      );
    }

    if (parsed.ok) return;

    const description = parsed.description ?? "unknown error";
    if (response.status === 429 || response.status >= 500) {
      throw new TelegramApiError(
        `Telegram API transient error: ${description}`,
        "transient",
        response.status,
      );
    }
    throw new TelegramApiError(
      `Telegram API rejected the request: ${description}`,
      "permanent",
      response.status,
    );
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "AbortError" ? "request timed out" : error.message;
  }
  return String(error);
}
