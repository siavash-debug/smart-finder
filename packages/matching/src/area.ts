/**
 * Area (square meters) matching. Hard — MASTER_PROMPT §6's reasonable-default example lists
 * `area_min` as a hard constraint.
 *
 * The current `posting` schema stores area as a single value, not a range, so the
 * "listing-side range overlap" case from MASTER_PROMPT §13 does not apply yet — documented in
 * ADR-0014 rather than invented.
 */

import { evaluateRange, type RangeEvaluation } from "./range.js";

export function evaluateArea(
  minAreaSqm: number | null,
  maxAreaSqm: number | null,
  actualAreaSqm: number | null,
): RangeEvaluation {
  return evaluateRange<number>({
    key: "area",
    bounds: { min: minAreaSqm, max: maxAreaSqm },
    actual: actualAreaSqm,
    hard: true,
    notApplicableExplanation: "No area preference was stated.",
    unknownExplanation: "Area is unknown for this listing.",
    belowMinExplanation: "Area is below the requested minimum.",
    aboveMaxExplanation: "Area is above the requested maximum.",
    matchedExplanation: "Area is within the requested range.",
  });
}
