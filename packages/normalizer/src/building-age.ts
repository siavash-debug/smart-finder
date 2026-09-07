/**
 * Building age / construction year parsing (MASTER_PROMPT §7).
 *
 * The canonical calendar for an explicit year is Jalali, matching the rest of the domain
 * (ADR — timestamps are UTC internally, Jalali at the display/input boundary). "۵ ساله"
 * (relative age) is deliberately NOT converted to an absolute construction year here: doing
 * that requires a reference "now", and baking a reference date into a normalizer function
 * would make its output depend on when it happens to run — the opposite of deterministic.
 * The relative form is returned as-is; a caller with a concrete reference date resolves it.
 */

import { normalizeDigits, parseInteger } from "./digits.js";
import { normalizeText } from "./text.js";

export type BuildingAgeResult =
  | { kind: "year"; jalaliYear: number; sourceText: string }
  | { kind: "new_construction"; sourceText: string }
  | { kind: "relative_age"; years: number; sourceText: string }
  | { kind: "unknown"; sourceText: string };

const NEW_CONSTRUCTION_WORDS = new Set(["نوساز", "کلیدنخورده"]);

/** Generous but real bounds on a Jalali year, to reject obvious garbage (e.g. "ساخت ۵") while
 *  not hard-coding "today" into what is meant to be a deterministic, time-independent parser. */
const MIN_JALALI_YEAR = 1200;
const MAX_JALALI_YEAR = 1500;

function isPlausibleJalaliYear(year: number): boolean {
  return Number.isInteger(year) && year >= MIN_JALALI_YEAR && year <= MAX_JALALI_YEAR;
}

export function parseBuildingAge(rawText: string): BuildingAgeResult {
  const sourceText = rawText;
  const working = normalizeDigits(normalizeText(rawText));

  if (NEW_CONSTRUCTION_WORDS.has(working)) {
    return { kind: "new_construction", sourceText };
  }

  const tokens = working.split(" ").filter(Boolean);

  // "ساخت ۱۴۰۲" or "سال ساخت ۱۴۰۲"
  if (tokens.length >= 2 && tokens[tokens.length - 2] === "ساخت") {
    const leading = tokens.slice(0, -2);
    if (leading.length === 0 || (leading.length === 1 && leading[0] === "سال")) {
      const year = parseInteger(tokens[tokens.length - 1]!);
      if (year !== null && isPlausibleJalaliYear(year)) {
        return { kind: "year", jalaliYear: year, sourceText };
      }
    }
    return { kind: "unknown", sourceText };
  }

  // "۵ ساله"
  if (tokens.length === 2 && tokens[1] === "ساله") {
    const years = parseInteger(tokens[0]!);
    if (years !== null && years >= 0) {
      return { kind: "relative_age", years, sourceText };
    }
  }

  return { kind: "unknown", sourceText };
}
