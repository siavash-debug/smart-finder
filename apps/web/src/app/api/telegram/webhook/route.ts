import { isTelegramUpdate, verifyWebhookSecret } from "@smart-finder/telegram";
import { loadWebEnv } from "@smart-finder/shared";

import { handleTelegramUpdate } from "@/lib/telegram/handle-update";
import { getTelegramClient } from "@/lib/telegram/client";
import { getPool } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Telegram webhook endpoint (MASTER_PROMPT-adjacent Phase 4 §6-§7). `nodejs` runtime: needs
 * `node:crypto`'s constant-time compare (via `@smart-finder/telegram`) and direct database
 * access, neither available on the edge runtime.
 *
 * Never statically prerendered or cached — same reasoning as `/healthz`/`/readyz`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

export async function POST(request: Request): Promise<Response> {
  const env = loadWebEnv();

  // Verified before the body is even read: an unauthenticated caller gets nothing back but a
  // 401, and never causes any parsing or database work.
  const providedSecret = request.headers.get(SECRET_HEADER);
  if (!verifyWebhookSecret(providedSecret, env.TELEGRAM_WEBHOOK_SECRET)) {
    // Deliberately generic: never echoes the received value, never distinguishes "missing
    // header" from "wrong value" (MASTER_PROMPT-adjacent Phase 4 §7 — never leak the secret,
    // including implicitly through a more specific error).
    logger.warn("telegram_webhook_rejected", { status: "unauthorized" });
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logger.warn("telegram_webhook_rejected", { status: "malformed_json" });
    return Response.json({ error: "malformed_request" }, { status: 400 });
  }

  if (!isTelegramUpdate(body)) {
    // Never logs the raw payload — Telegram messages carry user-controlled content
    // (MASTER_PROMPT-adjacent Phase 4 §7).
    logger.warn("telegram_webhook_rejected", { status: "malformed_update" });
    return Response.json({ error: "malformed_update" }, { status: 400 });
  }

  logger.info("telegram_webhook_received", { update_id: body.update_id });

  try {
    await handleTelegramUpdate(body, {
      pool: getPool(),
      telegramClient: getTelegramClient(),
      logger,
      now: () => new Date(),
    });
  } catch (error) {
    // Always acknowledge Telegram with 200 even on an internal failure: a 5xx here makes
    // Telegram retry the same update (and, after enough failures, can pause delivery
    // entirely), which would compound an application bug into a delivery outage. The error
    // is fully logged for us; Telegram just needs to stop resending this update.
    logger.error("telegram_update_handling_failed", {
      err: error,
      error_type: "handler_failed",
      update_id: body.update_id,
    });
  }

  return Response.json({ ok: true }, { status: 200 });
}
