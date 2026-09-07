/**
 * Area / size parsing for Persian real-estate text (MASTER_PROMPT §4).
 *
 * Canonical unit is square meters, represented as an integer. A unit suffix is required —
 * "متر", "متری", "m", "m2", or "sqm" — a bare number with no unit is too ambiguous to accept
 * as an area (it could just as easily be a price, a floor, or a room count) and returns
 * `unknown` rather than guessing.
 *
 * Approximation language ("حدود", "تقریبا", "نزدیک") is preserved as a flag, never turned into
 * false exactness. "بیشتر از" / "کمتر از" (more than / less than) are preserved as a
 * `comparator`, not silently folded into the plain value.
 */

import { normalizeDigits, parseDecimalLiteral } from "./digits.js";
import { normalizeText } from "./text.js";

export type AreaComparator = "at_least" | "at_most" | null;

interface AreaBase {
  approximate: boolean;
  comparator: AreaComparator;
  sourceText: string;
}

export type AreaParseResult =
  (AreaBase & { kind: "exact"; sqm: number }) | { kind: "unknown"; sourceText: string };

const APPROX_MARKERS = ["حدود", "تقریبا", "تقریباً", "نزدیک به", "نزدیک"];
const AT_LEAST_MARKERS = ["بیشتر از", "حداقل"];
const AT_MOST_MARKERS = ["کمتر از", "حداکثر"];

function stripLeadingMarker(
  text: string,
  markers: readonly string[],
): { text: string; matched: boolean } {
  for (const marker of markers) {
    if (text === marker) return { text: "", matched: true };
    if (text.startsWith(`${marker} `))
      return { text: text.slice(marker.length + 1).trim(), matched: true };
  }
  return { text, matched: false };
}

/** Trailing area units: Persian "متر"/"متری" (space-separated) and Latin "m"/"m2"/"sqm"
 *  (which may be glued directly onto the digits, e.g. "۱۲۵m"). */
const AREA_PATTERN = new RegExp("^([0-9]+(?:[.,][0-9]+)*)\\s*(متری|متر|sqm|m2|m)$", "i");

export function parseArea(rawText: string): AreaParseResult {
  const sourceText = rawText;
  let working = normalizeDigits(normalizeText(rawText));

  let comparator: AreaComparator = null;
  const atLeast = stripLeadingMarker(working, AT_LEAST_MARKERS);
  if (atLeast.matched) {
    working = atLeast.text;
    comparator = "at_least";
  } else {
    const atMost = stripLeadingMarker(working, AT_MOST_MARKERS);
    if (atMost.matched) {
      working = atMost.text;
      comparator = "at_most";
    }
  }

  const approx = stripLeadingMarker(working, APPROX_MARKERS);
  working = approx.text;

  if (working === "") return { kind: "unknown", sourceText };

  const match = AREA_PATTERN.exec(working);
  if (!match) return { kind: "unknown", sourceText };

  const literal = parseDecimalLiteral(match[1]!);
  if (literal === null || literal.fractionDigits > 0) return { kind: "unknown", sourceText };
  if (literal.integer <= 0n || literal.integer > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { kind: "unknown", sourceText };
  }

  return {
    kind: "exact",
    sqm: Number(literal.integer),
    approximate: approx.matched,
    comparator,
    sourceText,
  };
}
