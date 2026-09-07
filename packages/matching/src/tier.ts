/**
 * Tier classification (MASTER_PROMPT §9, as scoped by this phase's instructions — see
 * ADR-0014 for the reconciliation with `MASTER_PROMPT.md` §10's four-tier naming).
 *
 * Deterministic, integer-threshold rule — no magic numbers hidden in a formula:
 *
 * 1. Any confirmed **hard** violation → `near`, unconditionally. A high score can never
 *    override this (MASTER_PROMPT §9: "Do NOT allow a high numeric score to override a hard
 *    violation").
 * 2. Otherwise, sum a bounded "deviation" over every evaluated (non-`not_applicable`)
 *    criterion: `unknown` contributes 1 (limited uncertainty), a soft `mismatch` contributes
 *    2 (a confirmed but non-blocking deviation). (No hard mismatches can appear here — step 1
 *    already routed those listings to `near`.)
 *    - deviation `0` → `exact` — every stated preference is confirmed satisfied.
 *    - deviation `1`-`2` → `strong` — no violation, but limited uncertainty or one soft
 *      mismatch.
 *    - deviation `>= 3` → `near` — meaningful deviation from the request.
 */

import type { MatchCriterion, MatchTier } from "./types.js";

const UNKNOWN_DEVIATION = 1;
const SOFT_MISMATCH_DEVIATION = 2;

const STRONG_MAX_DEVIATION = 2;

export function classifyTier(
  hasHardViolation: boolean,
  criteria: readonly MatchCriterion[],
): MatchTier {
  if (hasHardViolation) return "near";

  const deviation = criteria.reduce((sum, criterion) => {
    if (criterion.status === "unknown") return sum + UNKNOWN_DEVIATION;
    if (criterion.status === "mismatch") return sum + SOFT_MISMATCH_DEVIATION;
    return sum;
  }, 0);

  if (deviation === 0) return "exact";
  if (deviation <= STRONG_MAX_DEVIATION) return "strong";
  return "near";
}
