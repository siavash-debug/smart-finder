/**
 * Tri-state boolean property attributes (MASTER_PROMPT §8): parking, elevator, storage,
 * balcony, pool, guard, lobby, jacuzzi.
 *
 * The defining rule of this module: **absence of a mention is `null` (unknown), never
 * `false`.** "۱۲۵ متر، ۲ خواب" says nothing about parking or elevator — both stay unknown,
 * not "does not have." A value only becomes `false` when the text explicitly says so
 * ("پارکینگ ندارد", "بدون پارکینگ", "فاقد پارکینگ").
 *
 * A bare mention with no negation ("پارکینگ" on its own, in a checklist-style listing) is
 * treated as `true` — this is the deterministic reading real Divar listings use, and it's a
 * documented rule, not a guess: amenities are listed when present, not enumerated as absent.
 */

import { normalizeText } from "./text.js";

export type TriState = true | false | null;

export type AttributeName =
  "parking" | "elevator" | "storage" | "balcony" | "pool" | "guard" | "lobby" | "jacuzzi";

export const ATTRIBUTE_NOUNS: Readonly<Record<AttributeName, readonly string[]>> = {
  parking: ["پارکینگ"],
  elevator: ["آسانسور"],
  storage: ["انباری"],
  balcony: ["بالکن", "تراس"],
  pool: ["استخر"],
  guard: ["نگهبانی", "نگهبان"],
  lobby: ["لابی"],
  jacuzzi: ["جکوزی"],
};

const NEGATIVE_SUFFIX = "ندارد";
const NEGATIVE_PREFIXES = new Set(["بدون", "فاقد"]);
const POSITIVE_SUFFIX = "دارد";
const POSITIVE_PREFIX = "دارای";

type Signal = "positive" | "negative" | "bare";

/**
 * Parses a single attribute's presence out of a free-text description. `text` is expected to
 * be the relevant sentence or listing description to scan — this function searches for the
 * attribute's noun as a whole token, so it never matches the noun as a substring of an
 * unrelated word.
 */
/** Punctuation left glued to a token after `normalizeText` (which canonicalizes character
 *  forms but doesn't add spacing) — e.g. the comma in "پارکینگ,". Stripped per-token before
 *  any word comparison, so "پارکینگ," matches the noun "پارکینگ" and "دارد." matches "دارد". */
const EDGE_PUNCTUATION = new RegExp("^[,.;:!؟]+|[,.;:!؟]+$", "g");

function cleanToken(token: string): string {
  return token.replace(EDGE_PUNCTUATION, "");
}

export function parseAttribute(attribute: AttributeName, rawText: string): TriState {
  const tokens = normalizeText(rawText).split(" ").map(cleanToken).filter(Boolean);
  const nouns = new Set(ATTRIBUTE_NOUNS[attribute]);

  const signals: Signal[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (!nouns.has(tokens[i]!)) continue;

    const previous = tokens[i - 1];
    const next = tokens[i + 1];

    if (next === NEGATIVE_SUFFIX || (previous !== undefined && NEGATIVE_PREFIXES.has(previous))) {
      signals.push("negative");
    } else if (next === POSITIVE_SUFFIX || previous === POSITIVE_PREFIX) {
      signals.push("positive");
    } else {
      signals.push("bare");
    }
  }

  if (signals.length === 0) return null; // not mentioned at all — unknown, never false

  const hasNegative = signals.includes("negative");
  const hasPositive = signals.some((s) => s === "positive" || s === "bare");
  if (hasNegative && hasPositive) return null; // contradictory mentions — unknown, not a guess

  return hasNegative ? false : true;
}

/** Parses every known attribute from the same text in one pass — a convenience for scanning a
 *  full listing description or user request once instead of once per attribute. */
export function parseAllAttributes(rawText: string): Record<AttributeName, TriState> {
  const result = {} as Record<AttributeName, TriState>;
  for (const attribute of Object.keys(ATTRIBUTE_NOUNS) as AttributeName[]) {
    result[attribute] = parseAttribute(attribute, rawText);
  }
  return result;
}
