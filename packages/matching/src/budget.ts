/**
 * Budget (price) matching. Hard: MASTER_PROMPT §6's own reasonable-default example lists
 * `budget_max` as a hard constraint, and §14 requires exact Toman/`bigint` arithmetic — this
 * reuses `evaluateRange<bigint>`, so there is no floating point anywhere on this path
 * (ADR-0005).
 *
 * Deliberately NOT inferring a total price from a per-square-meter price even when both
 * `areaSqm` and a hypothetical per-meter figure are known — MASTER_PROMPT §14 forbids that
 * unless the domain explicitly provides for it, and the current snapshot type does not.
 */

import { evaluateRange, type RangeEvaluation } from "./range.js";

export function evaluateBudget(
  minPriceToman: bigint | null,
  maxPriceToman: bigint | null,
  actualPriceToman: bigint | null,
): RangeEvaluation {
  return evaluateRange<bigint>({
    key: "budget",
    bounds: { min: minPriceToman, max: maxPriceToman },
    actual: actualPriceToman,
    hard: true,
    notApplicableExplanation: "No budget preference was stated.",
    unknownExplanation: "Price is unknown for this listing.",
    belowMinExplanation: "Price is below the requested minimum budget.",
    aboveMaxExplanation: "Price is above the requested maximum budget.",
    matchedExplanation: "Price is within the requested budget.",
  });
}
