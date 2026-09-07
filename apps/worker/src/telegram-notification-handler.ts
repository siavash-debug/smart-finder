/**
 * The `send_telegram_notification` job handler — the asynchronous half of notification
 * delivery (MASTER_PROMPT-adjacent Phase 4 §13-§16). The synchronous half (bot command
 * replies, the preference-summary interaction) lives in `apps/web`'s webhook handler and
 * never touches this job type; only alert-style notifications not tied to a live request go
 * through here.
 *
 * Retry/backoff is entirely the existing `job` table's (Phase 1, unchanged) — this handler
 * just throws on a transient failure (the job dispatcher's `failJob` takes it from there) and
 * resolves normally on success, permanent failure, or quiet-hours deferral. See
 * `notification-repository.ts` for why delivery is claimed via `job`, not by polling
 * `notification` directly.
 */

import {
  findUserById,
  getNotificationById,
  markNotificationFailed,
  markNotificationSent,
  recordNotificationAttemptFailure,
  rescheduleNotification,
  enqueueJob,
  type DatabasePool,
} from "@smart-finder/database";
import {
  isWithinQuietHours,
  nextAllowedSendTime,
  TelegramApiError,
  welcomeMessage,
  type TelegramClient,
} from "@smart-finder/telegram";

import type { JobHandler, JobHandlerContext } from "./job-dispatcher.js";

export const SEND_TELEGRAM_NOTIFICATION_JOB_TYPE = "send_telegram_notification";

export interface SendTelegramNotificationDeps {
  pool: DatabasePool;
  telegramClient: TelegramClient;
  /** Injectable so quiet-hours behavior is deterministically testable. */
  now?: () => Date;
}

function renderNotificationText(template: string): string {
  // No real alert template exists yet — the match-alert trigger is Phase 6+ fan-out, out of
  // scope here (MASTER_PROMPT-adjacent Phase 4 §3). "telegram_welcome" is the one template
  // this phase's own tests exercise end-to-end through the real delivery pipeline; anything
  // else gets a generic, honest placeholder rather than fabricated content.
  if (template === "telegram_welcome") return welcomeMessage();
  return "به‌روزرسانی جدیدی برای شما وجود دارد.";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createSendTelegramNotificationHandler(
  deps: SendTelegramNotificationDeps,
): JobHandler {
  const now = deps.now ?? (() => new Date());

  return async (payload: Record<string, unknown>, context: JobHandlerContext): Promise<void> => {
    const notificationId = payload.notificationId;
    if (typeof notificationId !== "string") {
      throw new Error('job payload missing a string "notificationId"');
    }

    const notification = await getNotificationById(deps.pool, notificationId);
    if (notification === null) {
      context.logger.warn("notification_not_found", { status: "skipped" });
      return;
    }
    if (notification.status !== "pending") {
      // Already sent/failed/suppressed by an earlier attempt — idempotent no-op, not an
      // error. Guards against a duplicate job (e.g. a retry racing a still-in-flight claim).
      context.logger.info("notification_already_resolved", { status: notification.status });
      return;
    }

    const currentTime = now();
    if (isWithinQuietHours(currentTime)) {
      const deferredTo = nextAllowedSendTime(currentTime)!;
      await rescheduleNotification(deps.pool, notification.id, deferredTo);
      await enqueueJob(deps.pool, {
        jobType: SEND_TELEGRAM_NOTIFICATION_JOB_TYPE,
        payload: { notificationId },
        runAt: deferredTo,
      });
      context.logger.info("notification_deferred_quiet_hours", {
        status: "deferred",
        scheduled_for: deferredTo.toISOString(),
      });
      return;
    }

    const user = await findUserById(deps.pool, notification.user_id);
    if (user === null) {
      await markNotificationFailed(deps.pool, notification.id, "app_user not found");
      context.logger.error("notification_user_not_found", { error_type: "user_not_found" });
      return;
    }

    try {
      await deps.telegramClient.sendMessage({
        chatId: Number(user.telegram_user_id),
        text: renderNotificationText(notification.template),
      });
      await markNotificationSent(deps.pool, notification.id);
      context.logger.info("notification_sent", { status: "sent" });
    } catch (error) {
      const message = errorMessage(error);
      if (error instanceof TelegramApiError && error.kind === "permanent") {
        await markNotificationFailed(deps.pool, notification.id, message);
        context.logger.error("notification_failed", {
          error_type: "permanent",
          status: "failed",
        });
        return; // permanent — no point retrying (MASTER_PROMPT-adjacent Phase 4 §20)
      }

      await recordNotificationAttemptFailure(deps.pool, notification.id, message);
      context.logger.warn("notification_send_attempt_failed", {
        err: error,
        error_type: "transient",
      });
      throw error; // transient — let the job's own retry/backoff (Phase 1) handle it
    }
  };
}
