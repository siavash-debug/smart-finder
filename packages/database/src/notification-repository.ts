/**
 * `notification` repository (Phase 4). The table itself is Phase 1 schema
 * (`0002_core_schema.sql`) — nothing here required a schema change.
 *
 * Delivery is claimed and retried through the existing `job` table
 * (`job_type = 'send_telegram_notification'`, `payload.notificationId`), not by polling
 * `notification` directly: `notification.status` has no `processing` value in its CHECK
 * constraint, so there is no race-safe way to claim a row here the way `job-queue.ts` claims
 * a job (`SELECT ... FOR UPDATE SKIP LOCKED` then an atomic status flip). The `job` table
 * already solves exactly this, tested, since Phase 1 — reused rather than duplicated. A
 * `notification` row is the durable, user-facing record of what was attempted and its
 * outcome; the `job` row is the retry/backoff engine (ADR-0015).
 */

import type { NotificationRow, NotificationStatus } from "./domain.js";
import type { Queryable } from "./pool.js";

export interface CreateNotificationInput {
  userId: string;
  template: string;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  matchId?: string;
  postingId?: string;
  scheduledFor?: Date;
}

/**
 * Idempotent by `idempotency_key`: creating the "same" notification twice (e.g. a retried
 * caller, or two workers racing to raise the same alert) returns the original row rather than
 * erroring or inserting a duplicate — `ON CONFLICT DO NOTHING` plus a follow-up read, in one
 * round trip's worth of intent even though it's two statements, because Postgres has no
 * "upsert and tell me whether it was the conflict branch" single-statement form that also
 * returns the pre-existing row's other columns cleanly here.
 */
export async function createNotification(
  pool: Queryable,
  input: CreateNotificationInput,
): Promise<NotificationRow> {
  const { rows } = await pool.query<NotificationRow>(
    `INSERT INTO notification
       (user_id, match_id, posting_id, template, payload, idempotency_key, scheduled_for)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()))
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [
      input.userId,
      input.matchId ?? null,
      input.postingId ?? null,
      input.template,
      input.payload ?? {},
      input.idempotencyKey,
      input.scheduledFor ?? null,
    ],
  );
  if (rows[0] !== undefined) return rows[0];

  const existing = await getNotificationByIdempotencyKey(pool, input.idempotencyKey);
  if (existing === null) {
    // Should be unreachable: the INSERT just told us a conflicting row exists. Surfacing this
    // as a real error rather than throwing away the possibility is cheap insurance.
    throw new Error(`notification insert conflicted but no row found for idempotency key`);
  }
  return existing;
}

export async function getNotificationById(
  pool: Queryable,
  id: string,
): Promise<NotificationRow | null> {
  const { rows } = await pool.query<NotificationRow>("SELECT * FROM notification WHERE id = $1", [
    id,
  ]);
  return rows[0] ?? null;
}

export async function getNotificationByIdempotencyKey(
  pool: Queryable,
  idempotencyKey: string,
): Promise<NotificationRow | null> {
  const { rows } = await pool.query<NotificationRow>(
    "SELECT * FROM notification WHERE idempotency_key = $1",
    [idempotencyKey],
  );
  return rows[0] ?? null;
}

/** Marks a notification delivered. A no-op (returns `false`) if it wasn't `pending` — sending
 *  is meant to happen at most once per notification. */
export async function markNotificationSent(pool: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE notification SET status = 'sent', sent_at = now(), attempts = attempts + 1
     WHERE id = $1 AND status = 'pending'`,
    [id],
  );
  return rowCount === 1;
}

/** Terminal failure — no more retries will happen for this notification (the owning `job` has
 *  exhausted its attempts, or the failure is permanent). */
export async function markNotificationFailed(
  pool: Queryable,
  id: string,
  error: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE notification SET status = 'failed', last_error = $2, attempts = attempts + 1
     WHERE id = $1 AND status = 'pending'`,
    [id, error],
  );
  return rowCount === 1;
}

/** Records a transient send failure without ending the notification's life — the owning `job`
 *  will retry it; this only keeps `attempts`/`last_error` current for observability. */
export async function recordNotificationAttemptFailure(
  pool: Queryable,
  id: string,
  error: string,
): Promise<void> {
  await pool.query(
    `UPDATE notification SET last_error = $2, attempts = attempts + 1
     WHERE id = $1 AND status = 'pending'`,
    [id, error],
  );
}

/** Suppressed: deliberately never sent (rate-limited, or a future opt-out/quiet policy). */
export async function markNotificationSuppressed(
  pool: Queryable,
  id: string,
  reason: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE notification SET status = 'suppressed', last_error = $2
     WHERE id = $1 AND status = 'pending'`,
    [id, reason],
  );
  return rowCount === 1;
}

/** Quiet-hours deferral: stays `pending`, just moved later — not a failure, not a retry. */
export async function rescheduleNotification(
  pool: Queryable,
  id: string,
  scheduledFor: Date,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    "UPDATE notification SET scheduled_for = $2 WHERE id = $1 AND status = 'pending'",
    [id, scheduledFor],
  );
  return rowCount === 1;
}

/** How many notifications have been created for this user since `since` — the basis for the
 *  notification-triggering rate limit (MASTER_PROMPT-adjacent Phase 4 §17). Counts every
 *  status, including `suppressed`: a burst of attempts is what's being bounded, not just
 *  successful sends. */
export async function countNotificationsForUserSince(
  pool: Queryable,
  userId: string,
  since: Date,
): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM notification WHERE user_id = $1 AND created_at >= $2",
    [userId, since],
  );
  return Number(rows[0]?.count ?? "0");
}

export async function countNotificationsByStatus(
  pool: Queryable,
  status: NotificationStatus,
): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM notification WHERE status = $1",
    [status],
  );
  return Number(rows[0]?.count ?? "0");
}
