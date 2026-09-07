/**
 * Deterministic matching engine (MASTER_PROMPT §9-§13, Phase 3). Pure, synchronous, no
 * database/network/LLM dependency (ADR-0007, ADR-0014).
 */

export { score } from "./match.js";

export type {
  CriterionStatus,
  MatchCriterion,
  MatchListingSnapshot,
  MatchProfileSnapshot,
  MatchResult,
  MatchTier,
  MatchViolation,
  TriState,
  ViolationSeverity,
} from "./types.js";

// Individual evaluators — exported for direct unit testing and for future phases (e.g. a
// notification pipeline that only cares about one criterion) that don't need the full
// `score()` composition.
export { evaluateArea } from "./area.js";
export { evaluateAttribute, type AttributeEvaluation } from "./attribute.js";
export { evaluateBudget } from "./budget.js";
export { evaluateBuildingAge } from "./building-age.js";
export { evaluateFloor, type FloorCategory } from "./floor.js";
export { evaluateDistrict, evaluateNeighborhood, type LocationEvaluation } from "./location.js";
export { evaluateRooms } from "./rooms.js";
export {
  evaluateRange,
  type EvaluateRangeOptions,
  type RangeBounds,
  type RangeEvaluation,
} from "./range.js";
export { classifyTier } from "./tier.js";
export {
  calculateScore,
  HARD_VIOLATION_PENALTY,
  SOFT_MISMATCH_PENALTY,
  UNKNOWN_PENALTY,
} from "./score.js";
