/**
 * Building age matching. Soft — MASTER_PROMPT §6's reasonable-default example lists
 * "preferred newer construction" as a soft preference.
 *
 * Compares relative age in years (`posting.building_age_years`, `search_profile.
 * min/max_building_age_years` — the locked Phase 1 schema), not an absolute Jalali
 * construction year. See ADR-0014's "construction year" section: MASTER_PROMPT §19's own
 * examples assume an absolute-year comparison, but the schema this package must consume
 * stores a relative age instead, and comparing two ages needs no reference "now" — keeping
 * this function honest about not depending on wall-clock time (MASTER_PROMPT §2).
 */

import { evaluateRange, type RangeEvaluation } from "./range.js";

export function evaluateBuildingAge(
  minBuildingAgeYears: number | null,
  maxBuildingAgeYears: number | null,
  actualBuildingAgeYears: number | null,
): RangeEvaluation {
  return evaluateRange<number>({
    key: "building_age",
    bounds: { min: minBuildingAgeYears, max: maxBuildingAgeYears },
    actual: actualBuildingAgeYears,
    hard: false,
    notApplicableExplanation: "No building-age preference was stated.",
    unknownExplanation: "Building age is unknown for this listing.",
    belowMinExplanation: "Building is newer than the requested minimum age.",
    aboveMaxExplanation: "Building is older than the requested maximum age.",
    matchedExplanation: "Building age is within the requested range.",
  });
}
