/**
 * Semantic classification of Divar's `unexpandable-info-row` label/value pairs (MASTER_PROMPT's
 * layered-extraction requirement, this phase). Exact-string label matching is brittle: the same
 * field can be labeled with harmless wording/Unicode variation ("اجارهٔ ماهانه" vs
 * "اجاره ماهانه" — a combining Arabic hamza, see `@smart-finder/normalizer`'s `normalizeText`
 * fix for this exact case). This module classifies a *normalized* label into a semantic
 * category by keyword content, not exact match, so it survives label rewording that doesn't
 * change meaning — while still never guessing: a label matching no known category is preserved
 * as `unknown`, not dropped and not misassigned to the wrong field.
 *
 * Layering, per the design this phase requires:
 *   1. normalize the label      → `normalizeText` (character/whitespace/diacritic canonicalization)
 *   2. classify the category    → `classifyInfoRowLabel` (keyword matching, most-specific first)
 *   3. group by category        → `classifyInfoRows` (also preserves unmatched rows)
 * Parsing the associated value into a typed field, and validating it, stays `parse.ts`'s and
 * `normalize.ts`'s job respectively — this module only answers "what does this label mean?".
 */

import { normalizeText } from "@smart-finder/normalizer";

export type DivarInfoRowCategory =
  | "deposit" // ودیعه — rent's deposit amount
  | "monthlyRent" // اجارهٔ ماهانه / اجاره ماهانه — rent's recurring monthly amount
  | "rentConvertibility" // ودیعه و اجاره — e.g. "غیر قابل تبدیل" (not convertible)
  | "saleTotalPrice" // قیمت کل — sale's total price
  | "salePricePerSqm" // قیمت هر متر — sale's per-square-meter price, NEVER the total
  | "floor"; // طبقه

interface CategoryMatcher {
  category: DivarInfoRowCategory;
  /** Tested against the label AFTER `normalizeText`. Order matters — more specific matchers
   *  (e.g. "ودیعه و اجاره", which itself contains "ودیعه") must run before more general ones. */
  matches: (normalizedLabel: string) => boolean;
}

const CATEGORY_MATCHERS: readonly CategoryMatcher[] = [
  {
    category: "rentConvertibility",
    matches: (label) => label.includes("ودیعه") && label.includes("اجاره"),
  },
  { category: "deposit", matches: (label) => label.includes("ودیعه") },
  {
    category: "monthlyRent",
    matches: (label) => label.includes("اجاره") && label.includes("ماهان"),
  },
  {
    category: "salePricePerSqm",
    matches: (label) => label.includes("قیمت") && label.includes("متر"),
  },
  {
    category: "saleTotalPrice",
    matches: (label) => label.includes("قیمت") && label.includes("کل"),
  },
  { category: "floor", matches: (label) => label.includes("طبقه") },
];

/** Classifies one normalized label. Returns `null` for a label that matches no known category
 *  — the caller preserves it as `unknown`, never silently discarding or misassigning it. */
export function classifyInfoRowLabel(rawLabel: string): DivarInfoRowCategory | null {
  const normalized = normalizeText(rawLabel);
  for (const matcher of CATEGORY_MATCHERS) {
    if (matcher.matches(normalized)) return matcher.category;
  }
  return null;
}

export interface ClassifiedInfoRows {
  byCategory: Partial<Record<DivarInfoRowCategory, string>>;
  /** Every info row whose label didn't match a known category, keyed by its original (not
   *  normalized) label — preserved rather than dropped, per this phase's explicit requirement
   *  not to discard information the current domain model doesn't yet have a place for. */
  unknown: Record<string, string>;
}

/**
 * Groups a detail page's raw `infoRows` by semantic category. If two distinct labels somehow
 * classify to the same category (not expected in practice — Divar's own info-row set is small
 * and each category has one label per listing), the first one encountered wins and the rest is
 * preserved under `unknown` rather than silently overwritten, so nothing is lost either way.
 */
export function classifyInfoRows(infoRows: Record<string, string>): ClassifiedInfoRows {
  const byCategory: Partial<Record<DivarInfoRowCategory, string>> = {};
  const unknown: Record<string, string> = {};

  for (const [label, value] of Object.entries(infoRows)) {
    const category = classifyInfoRowLabel(label);
    if (category === null) {
      unknown[label] = value;
    } else if (category in byCategory) {
      unknown[label] = value;
    } else {
      byCategory[category] = value;
    }
  }

  return { byCategory, unknown };
}
