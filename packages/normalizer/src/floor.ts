/**
 * Floor parsing for Persian real-estate text (MASTER_PROMPT §6).
 *
 * The schema's `posting.floor` column (migration `0002_core_schema`) is a plain nullable
 * integer with no special-category enum, so a category like "همکف" (ground floor) or
 * "زیرزمین" (basement) is deliberately NOT mapped to an arbitrary integer here (0, -1, ...) —
 * that would be inventing a domain decision this module has no authority to make. Categories
 * come back as their own `kind: "category"` result instead; a caller that wants them stored
 * as a specific integer makes that mapping explicitly, not this module implicitly.
 */

import { normalizeDigits, parseInteger } from "./digits.js";
import { normalizeText } from "./text.js";

export type FloorCategory = "ground" | "basement" | "penthouse";

export type FloorParseResult =
  | { kind: "numeric"; floor: number; totalFloors: number | null; sourceText: string }
  | { kind: "category"; category: FloorCategory; sourceText: string }
  | { kind: "unknown"; sourceText: string };

const CATEGORY_WORDS: Readonly<Record<string, FloorCategory>> = {
  همکف: "ground",
  زیرزمین: "basement",
  // normalizeText strips the ZWNJ from "پنت‌هاوس", collapsing it to this single form.
  پنتهاوس: "penthouse",
};

/** Ordinal floor words. Persian ordinals are irregular for 1st-3rd and regular (cardinal +
 *  "م") from 4th on; this is an explicit table rather than a suffix-stripping algorithm,
 *  which would risk misparsing an unrelated "م"-ending word as a bogus ordinal. */
const ORDINAL_WORDS: Readonly<Record<string, number>> = {
  اول: 1,
  یکم: 1,
  دوم: 2,
  سوم: 3,
  چهارم: 4,
  پنجم: 5,
  ششم: 6,
  هفتم: 7,
  هشتم: 8,
  نهم: 9,
  دهم: 10,
  یازدهم: 11,
  دوازدهم: 12,
  سیزدهم: 13,
  چهاردهم: 14,
  پانزدهم: 15,
  شانزدهم: 16,
  هفدهم: 17,
  هجدهم: 18,
  نوزدهم: 19,
  بیستم: 20,
};

const FLOOR_PREFIX = "طبقه";
const OF_TOKEN = "از";

export function parseFloor(rawText: string): FloorParseResult {
  const sourceText = rawText;
  let working = normalizeDigits(normalizeText(rawText));

  if (working in CATEGORY_WORDS) {
    return { kind: "category", category: CATEGORY_WORDS[working]!, sourceText };
  }

  if (working === FLOOR_PREFIX || working === "") return { kind: "unknown", sourceText };
  if (working.startsWith(`${FLOOR_PREFIX} `)) {
    working = working.slice(FLOOR_PREFIX.length + 1).trim();
  }

  const tokens = working.split(" ").filter(Boolean);

  // "۳ از ۵" — floor از total, either side digit or ordinal-word for the floor part.
  const ofIndex = tokens.indexOf(OF_TOKEN);
  if (ofIndex > 0 && ofIndex < tokens.length - 1) {
    const floorPart = tokens.slice(0, ofIndex).join(" ");
    const totalPart = tokens.slice(ofIndex + 1).join(" ");
    const floor = resolveFloorNumber(floorPart);
    const total = parseInteger(totalPart);
    if (floor === null || total === null) return { kind: "unknown", sourceText };
    return { kind: "numeric", floor, totalFloors: total, sourceText };
  }

  const floor = resolveFloorNumber(working);
  if (floor === null) return { kind: "unknown", sourceText };
  return { kind: "numeric", floor, totalFloors: null, sourceText };
}

function resolveFloorNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed in ORDINAL_WORDS) return ORDINAL_WORDS[trimmed]!;
  return parseInteger(trimmed);
}
