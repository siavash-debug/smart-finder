import { describe, expect, it, vi } from "vitest";

import { TelegramApiError, TelegramClient, type TelegramFetch } from "./client.js";

const BOT_TOKEN = "123456:test-token-not-real";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("TelegramClient.sendMessage", () => {
  it("succeeds on a normal 200 ok response", async () => {
    const fetchImpl = vi.fn<TelegramFetch>(() =>
      Promise.resolve(jsonResponse(200, { ok: true, result: {} })),
    );
    const client = new TelegramClient({ botToken: BOT_TOKEN, fetchImpl });

    await expect(client.sendMessage({ chatId: 42, text: "سلام" })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never puts the bot token in a thrown error message", async () => {
    const fetchImpl = vi.fn<TelegramFetch>(() =>
      Promise.resolve(jsonResponse(400, { ok: false, description: "Bad Request: chat not found" })),
    );
    const client = new TelegramClient({ botToken: BOT_TOKEN, fetchImpl });

    let message = "";
    try {
      await client.sendMessage({ chatId: 42, text: "hi" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain(BOT_TOKEN);
  });

  it("sends the bot token only in the request URL, not the body", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const fetchImpl = vi.fn<TelegramFetch>((url, init) => {
      capturedUrl = url;
      capturedBody = String(init.body as string);
      return Promise.resolve(jsonResponse(200, { ok: true }));
    });
    const client = new TelegramClient({ botToken: BOT_TOKEN, fetchImpl });

    await client.sendMessage({ chatId: 1, text: "x" });

    expect(capturedUrl).toContain(BOT_TOKEN);
    expect(capturedBody).not.toContain(BOT_TOKEN);
  });

  it("includes an inline keyboard when provided", async () => {
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn<TelegramFetch>((_url, init) => {
      capturedBody = JSON.parse(String(init.body as string)) as Record<string, unknown>;
      return Promise.resolve(jsonResponse(200, { ok: true }));
    });
    const client = new TelegramClient({ botToken: BOT_TOKEN, fetchImpl });

    await client.sendMessage({
      chatId: 1,
      text: "تأیید می‌کنید؟",
      inlineKeyboard: [[{ text: "تأیید", callback_data: "pref:ack" }]],
    });

    expect(capturedBody.reply_markup).toEqual({
      inline_keyboard: [[{ text: "تأیید", callback_data: "pref:ack" }]],
    });
  });

  it("classifies a network failure as transient", async () => {
    const fetchImpl = vi.fn<TelegramFetch>(() => Promise.reject(new Error("ECONNRESET")));
    const client = new TelegramClient({ botToken: BOT_TOKEN, fetchImpl });

    await expect(client.sendMessage({ chatId: 1, text: "x" })).rejects.toMatchObject({
      kind: "transient",
    });
  });

  it("classifies a timeout as transient", async () => {
    const fetchImpl = vi.fn<TelegramFetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const client = new TelegramClient({ botToken: BOT_TOKEN, timeoutMs: 10, fetchImpl });

    await expect(client.sendMessage({ chatId: 1, text: "x" })).rejects.toMatchObject({
      kind: "transient",
    });
  });

  it("classifies a 429 as transient", async () => {
    const fetchImpl = vi.fn<TelegramFetch>(() =>
      Promise.resolve(jsonResponse(429, { ok: false, description: "Too Many Requests" })),
    );
    const client = new TelegramClient({ botToken: BOT_TOKEN, fetchImpl });

    await expect(client.sendMessage({ chatId: 1, text: "x" })).rejects.toMatchObject({
      kind: "transient",
      statusCode: 429,
    });
  });

  it("classifies a 5xx as transient", async () => {
    const fetchImpl = vi.fn<TelegramFetch>(() =>
      Promise.resolve(jsonResponse(502, { ok: false, description: "Bad Gateway" })),
    );
    const client = new TelegramClient({ botToken: BOT_TOKEN, fetchImpl });

    await expect(client.sendMessage({ chatId: 1, text: "x" })).rejects.toMatchObject({
      kind: "transient",
      statusCode: 502,
    });
  });

  it("classifies a 400 as permanent", async () => {
    const fetchImpl = vi.fn<TelegramFetch>(() =>
      Promise.resolve(jsonResponse(400, { ok: false, description: "Bad Request: chat not found" })),
    );
    const client = new TelegramClient({ botToken: BOT_TOKEN, fetchImpl });

    await expect(client.sendMessage({ chatId: 1, text: "x" })).rejects.toMatchObject({
      kind: "permanent",
      statusCode: 400,
    });
  });

  it("classifies a 403 (bot blocked by user) as permanent", async () => {
    const fetchImpl = vi.fn<TelegramFetch>(() =>
      Promise.resolve(
        jsonResponse(403, { ok: false, description: "Forbidden: bot was blocked by the user" }),
      ),
    );
    const client = new TelegramClient({ botToken: BOT_TOKEN, fetchImpl });

    await expect(client.sendMessage({ chatId: 1, text: "x" })).rejects.toMatchObject({
      kind: "permanent",
      statusCode: 403,
    });
  });

  it("classifies an unparseable response body as malformed_response", async () => {
    const fetchImpl = vi.fn<TelegramFetch>(() =>
      Promise.resolve(new Response("not json", { status: 200 })),
    );
    const client = new TelegramClient({ botToken: BOT_TOKEN, fetchImpl });

    await expect(client.sendMessage({ chatId: 1, text: "x" })).rejects.toBeInstanceOf(
      TelegramApiError,
    );
    await expect(client.sendMessage({ chatId: 1, text: "x" })).rejects.toMatchObject({
      kind: "malformed_response",
    });
  });
});

describe("TelegramClient.answerCallbackQuery", () => {
  it("succeeds on a normal response", async () => {
    const fetchImpl = vi.fn<TelegramFetch>(() => Promise.resolve(jsonResponse(200, { ok: true })));
    const client = new TelegramClient({ botToken: BOT_TOKEN, fetchImpl });

    await expect(client.answerCallbackQuery({ callbackQueryId: "cbq-1" })).resolves.toBeUndefined();
  });
});
