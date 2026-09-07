/**
 * Floor matching. Soft — MASTER_PROMPT §6's reasonable-default example lists "preferred
 * floor" as a soft preference.
 *
 * Respects the special floor categories from `@smart-finder/normalizer`'s `parseFloor`
 * (`ground` / `basement` / `penthouse`) rather than coercing them to an arbitrary numeric
 * floor (MASTER_PROMPT §18) — `همکف` is never treated as floor 0, `زیرزمین` never as -1. The
 * locked `search_profile` schema has no floor-category preference column (only numeric
 * `min_floor`/`max_floor`), so a listing with only a category and no numeric floor cannot be
 * safely compared against a numeric range: MASTER_PROMPT §18 itself says exactly that case
 * should be `unknown` when there is insufficient information to compare safely.
 */

import { evaluateRange, type RangeEvaluation } from "./range.js";
import type { MatchCriterion } from "./types.js";

export type FloorCategory = "ground" | "basement" | "penthouse";

export function evaluateFloor(
  minFloor: number | null,
  maxFloor: number | null,
  actualFloor: number | null,
  actualFloorCategory: FloorCategory | null,
): RangeEvaluation {
  const hasPreference = minFloor !== null || maxFloor !== null;

  // A category with no numeric floor: safe to compare only when nothing was actually
  // requested (not_applicable); otherwise there is no numeric-range-safe comparison, so this
  // is `unknown` rather than a coerced guess.
  if (actualFloor === null && actualFloorCategory !== null) {
    const requested = hasPreference ? { min: minFloor, max: maxFloor } : undefined;
    const criterion: MatchCriterion = hasPreference
      ? {
          key: "floor",
          status: "unknown",
          requested,
          actual: actualFloorCategory,
          explanation: `Floor is a special category (${actualFloorCategory}), which cannot be safely compared to the requested numeric floor range.`,
        }
      : {
          key: "floor",
          status: "not_applicable",
          actual: actualFloorCategory,
          explanation: "No floor preference was stated.",
        };
    return { criterion, violation: null };
  }

  return evaluateRange<number>({
    key: "floor",
    bounds: { min: minFloor, max: maxFloor },
    actual: actualFloor,
    hard: false,
    notApplicableExplanation: "No floor preference was stated.",
    unknownExplanation: "Floor is unknown for this listing.",
    belowMinExplanation: "Floor is below the requested minimum.",
    aboveMaxExplanation: "Floor is above the requested maximum.",
    matchedExplanation: "Floor is within the requested range.",
  });
}
