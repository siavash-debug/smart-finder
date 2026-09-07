/**
 * Bedroom count matching. Hard. The locked `search_profile` schema models this as a
 * `[min_rooms, max_rooms]` range (not a single "exact" field) — an exact request like "2
 * bedrooms" is simply `min = max = 2`, which `evaluateRange` already handles correctly with
 * no special case needed.
 *
 * Only ever compares the normalized `rooms` integer — never infers a bedroom count from
 * parking spaces, floor count, area, or any other unrelated number (MASTER_PROMPT §15). That
 * guarantee lives one layer down, in `@smart-finder/normalizer`'s `parseRooms`; this function
 * only ever sees the already-extracted integer.
 */

import { evaluateRange, type RangeEvaluation } from "./range.js";

export function evaluateRooms(
  minRooms: number | null,
  maxRooms: number | null,
  actualRooms: number | null,
): RangeEvaluation {
  return evaluateRange<number>({
    key: "rooms",
    bounds: { min: minRooms, max: maxRooms },
    actual: actualRooms,
    hard: true,
    notApplicableExplanation: "No bedroom-count preference was stated.",
    unknownExplanation: "Bedroom count is unknown for this listing.",
    belowMinExplanation: "Bedroom count is below the requested minimum.",
    aboveMaxExplanation: "Bedroom count is above the requested maximum.",
    matchedExplanation: "Bedroom count matches the request.",
  });
}
