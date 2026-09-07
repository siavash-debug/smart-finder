/**
 * Deterministic sliding-window rate limiting (MASTER_PROMPT-adjacent Phase 4 §17). Pure: given
 * the caller's recent event timestamps and the current time, decide whether one more event is
 * allowed. No Redis, no external rate-limit service — the caller supplies the timestamps
 * (from `telegram_command_log` or `notification`, via `@smart-finder/database`), keeping this
 * package's "no database dependency" property (ADR-0007-style precedent) intact.
 */

export interface RateLimitPolicy {
  /** How far back to look, in milliseconds. */
  windowMs: number;
  /** How many events are allowed within that window before the next one is refused. */
  maxEvents: number;
}

export interface RateLimitDecision {
  limited: boolean;
  /** How many events (of the ones passed in) actually fell inside the window. */
  countInWindow: number;
}

/** Bot-command processing: generous enough that normal use never hits it, tight enough to
 *  stop a scripted flood. */
export const COMMAND_RATE_LIMIT: RateLimitPolicy = { windowMs: 60_000, maxEvents: 20 };

/** Notification creation per user: bounds how many alerts one user can accumulate in an hour,
 *  independent of how many listings might otherwise match. */
export const NOTIFICATION_RATE_LIMIT: RateLimitPolicy = { windowMs: 60 * 60_000, maxEvents: 30 };

export function checkRateLimit(
  recentEventTimestamps: readonly Date[],
  now: Date,
  policy: RateLimitPolicy,
): RateLimitDecision {
  const windowStart = now.getTime() - policy.windowMs;
  const countInWindow = recentEventTimestamps.filter((t) => t.getTime() >= windowStart).length;
  return { limited: countInWindow >= policy.maxEvents, countInWindow };
}
