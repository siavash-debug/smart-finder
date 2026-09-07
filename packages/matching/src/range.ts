/**
 * Shared range-containment logic for budget, area, rooms, and building age — every one of
 * them is "profile states an optional [min, max] bound; listing has one actual value or
 * unknown." `T` is constrained to `number | bigint` so `<`/`>` compare directly with no
 * cross-type arithmetic (`bigint` for money, per ADR-0005; `number` for everything else).
 */

import type { CriterionStatus, MatchCriterion, MatchViolation } from "./types.js";

export interface RangeBounds<T extends number | bigint> {
  min: T | null;
  max: T | null;
}

export interface RangeEvaluation {
  criterion: MatchCriterion;
  violation: MatchViolation | null;
}

export interface EvaluateRangeOptions<T extends number | bigint> {
  key: string;
  bounds: RangeBounds<T>;
  actual: T | null;
  hard: boolean;
  /** Prose for the `not_applicable` case — no preference was stated at all. */
  notApplicableExplanation: string;
  /** Prose for the `unknown` case — a preference was stated, but the listing doesn't say. */
  unknownExplanation: string;
  belowMinExplanation: string;
  aboveMaxExplanation: string;
  matchedExplanation: string;
}

/**
 * Pure range-containment check. Never mutates its inputs, never reads the clock, and returns
 * a fresh criterion/violation pair every call — the same inputs always produce the same
 * output (MASTER_PROMPT §20, determinism).
 */
export function evaluateRange<T extends number | bigint>(
  options: EvaluateRangeOptions<T>,
): RangeEvaluation {
  const { key, bounds, actual, hard } = options;
  const requested =
    bounds.min === null && bounds.max === null ? undefined : { min: bounds.min, max: bounds.max };

  if (bounds.min === null && bounds.max === null) {
    return {
      criterion: makeCriterion(
        key,
        "not_applicable",
        undefined,
        actual,
        options.notApplicableExplanation,
      ),
      violation: null,
    };
  }

  if (actual === null) {
    return {
      criterion: makeCriterion(key, "unknown", requested, null, options.unknownExplanation),
      violation: null,
    };
  }

  const belowMin = bounds.min !== null && actual < bounds.min;
  const aboveMax = bounds.max !== null && actual > bounds.max;

  if (belowMin || aboveMax) {
    const reason = belowMin ? options.belowMinExplanation : options.aboveMaxExplanation;
    const violation: MatchViolation = {
      key,
      severity: hard ? "hard" : "soft",
      requested,
      actual,
      reason,
    };
    return {
      criterion: makeCriterion(key, "mismatch", requested, actual, reason),
      violation,
    };
  }

  return {
    criterion: makeCriterion(key, "matched", requested, actual, options.matchedExplanation),
    violation: null,
  };
}

function makeCriterion(
  key: string,
  status: CriterionStatus,
  requested: unknown,
  actual: unknown,
  explanation: string,
): MatchCriterion {
  const criterion: MatchCriterion = { key, status, explanation };
  if (requested !== undefined) criterion.requested = requested;
  if (actual !== undefined && actual !== null) criterion.actual = actual;
  return criterion;
}
