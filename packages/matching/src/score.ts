/**
 * Bounded deterministic score (MASTER_PROMPT §10): `0 <= total <= 100`, integer, secondary to
 * `tier` — used only to order listings within the same tier, never to override a hard
 * violation's effect on tier classification (`tier.ts` never reads this value).
 *
 * A simple penalty subtraction from 100, not a weighted formula — MASTER_PROMPT §10: "Avoid
 * overly complicated weighted formulas." Penalties are flat per occurrence, not per-field
 * weighted, keeping the score trivially explainable: read the violation/criteria list and the
 * arithmetic is visible.
 */

import type { MatchCriterion, MatchViolation } from "./types.js";

export const HARD_VIOLATION_PENALTY = 40;
export const SOFT_MISMATCH_PENALTY = 12;
export const UNKNOWN_PENALTY = 4;

const MIN_SCORE = 0;
const MAX_SCORE = 100;

export function calculateScore(
  violations: readonly MatchViolation[],
  criteria: readonly MatchCriterion[],
): number {
  let score = MAX_SCORE;

  for (const violation of violations) {
    score -= violation.severity === "hard" ? HARD_VIOLATION_PENALTY : SOFT_MISMATCH_PENALTY;
  }
  for (const criterion of criteria) {
    if (criterion.status === "unknown") score -= UNKNOWN_PENALTY;
  }

  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
}
