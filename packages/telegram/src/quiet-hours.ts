/**
 * Quiet-hours policy (MASTER_PROMPT-adjacent Phase 4 §16). Fixed, documented, and the same
 * for every user — the schema has no per-user timezone or quiet-hours preference column, so
 * this does not invent one; a per-user policy is future work, tracked in ADR-0015.
 *
 * Policy: no notification is sent between 23:00 and 08:00 Asia/Tehran, inclusive of 23:00 and
 * exclusive of 08:00. Internal timestamps stay UTC (ARCHITECTURE §6); this module only ever
 * *reads* the wall-clock hour in Tehran to make the decision, and always returns a UTC
 * `Date` for "when to try again" — it never stores or reasons about non-UTC instants.
 *
 * The "now" used for the check is always an explicit parameter (MASTER_PROMPT §2: no
 * wall-clock dependency unless a reference time is passed in), so this stays as testable and
 * deterministic as `packages/matching`.
 */

const TIME_ZONE = "Asia/Tehran";
const QUIET_START_HOUR = 23;
const QUIET_END_HOUR = 8;

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function getLocalParts(instant: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** The timezone's offset from UTC, in minutes, at `instant` — derived by comparing how
 *  `instant` renders in `timeZone` against its own UTC value, which is correct for any
 *  timezone at any date without hard-coding a fixed offset (safe even if a timezone's rules
 *  ever changed, unlike assuming a constant "+03:30"). */
function offsetMinutesAt(instant: Date, timeZone: string): number {
  const local = getLocalParts(instant, timeZone);
  const asIfUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return Math.round((asIfUtc - instant.getTime()) / 60_000);
}

export function isWithinQuietHours(nowUtc: Date): boolean {
  const local = getLocalParts(nowUtc, TIME_ZONE);
  return local.hour >= QUIET_START_HOUR || local.hour < QUIET_END_HOUR;
}

/**
 * If `nowUtc` falls in quiet hours, returns the UTC instant of the next `08:00` Tehran time.
 * Returns `null` when it's not currently quiet hours (nothing to defer).
 */
export function nextAllowedSendTime(nowUtc: Date): Date | null {
  if (!isWithinQuietHours(nowUtc)) return null;

  const local = getLocalParts(nowUtc, TIME_ZONE);
  // Before 08:00: today's 08:00 is still ahead. At/after 23:00: tomorrow's 08:00.
  const targetDayOffset = local.hour < QUIET_END_HOUR ? 0 : 1;

  const guessUtcMs = Date.UTC(
    local.year,
    local.month - 1,
    local.day + targetDayOffset,
    QUIET_END_HOUR,
    0,
    0,
  );
  const offsetMinutes = offsetMinutesAt(new Date(guessUtcMs), TIME_ZONE);
  return new Date(guessUtcMs - offsetMinutes * 60_000);
}
