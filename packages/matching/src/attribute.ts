/**
 * Boolean attribute matching (parking, elevator, storage) — MASTER_PROMPT §16. Hard: the
 * schema names these columns `require_parking`/`require_elevator`/`require_storage`, which
 * this package reads as "when stated, it is a requirement" (ADR-0014).
 *
 * The full tri-state × tri-state truth table, exactly as MASTER_PROMPT §16 specifies:
 *
 * | profile \ listing | true      | false     | unknown   |
 * |--------------------|-----------|-----------|-----------|
 * | true (required)    | matched   | violation | unknown   |
 * | false (forbidden)  | violation | matched   | unknown   |
 * | null (not asked)   | not_applicable (regardless of listing value)                    |
 *
 * "Not requested" is never treated as "required false" — a `null` profile value short-
 * circuits to `not_applicable` before the listing value is even inspected.
 */

import type { MatchCriterion, MatchViolation, TriState } from "./types.js";

export interface AttributeEvaluation {
  criterion: MatchCriterion;
  violation: MatchViolation | null;
}

export function evaluateAttribute(
  key: string,
  label: string,
  requested: TriState,
  actual: TriState,
): AttributeEvaluation {
  if (requested === null) {
    return {
      criterion: {
        key,
        status: "not_applicable",
        explanation: `No ${label} preference was stated.`,
      },
      violation: null,
    };
  }

  if (actual === null) {
    return {
      criterion: {
        key,
        status: "unknown",
        requested,
        explanation: `${capitalize(label)} information is unknown for this listing.`,
      },
      violation: null,
    };
  }

  if (actual === requested) {
    const explanation = requested
      ? `${capitalize(label)} is present, as requested.`
      : `${capitalize(label)} is absent, as requested.`;
    return {
      criterion: { key, status: "matched", requested, actual, explanation },
      violation: null,
    };
  }

  const reason = requested
    ? `${capitalize(label)} was required but this listing does not have it.`
    : `${capitalize(label)} was required to be absent but this listing has it.`;
  const violation: MatchViolation = { key, severity: "hard", requested, actual, reason };
  return {
    criterion: { key, status: "mismatch", requested, actual, explanation: reason },
    violation,
  };
}

function capitalize(word: string): string {
  return word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1);
}
