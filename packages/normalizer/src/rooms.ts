/**
 * Bedroom-count parsing for Persian real-estate text (MASTER_PROMPT §5).
 *
 * A value is only ever produced when a number is directly attached to a recognized bedroom
 * unit word ("خواب", "خوابه", "اتاق", "اتاق خواب"). This module never scans a whole sentence
 * for "any number" — the false-positive case the brief calls out explicitly is
 * "۱۲۵ متر، ۲ پارکینگ" not becoming 2 bedrooms, and it's ruled out structurally: "پارکینگ" is
 * not one of the unit words this module recognizes, so the pattern simply never matches there.
 */

import { normalizeDigits, parseInteger } from "./digits.js";
import { parseNumberWordsToBigInt } from "./number-words.js";
import { normalizeText } from "./text.js";

export type RoomsParseResult =
  { kind: "exact"; bedrooms: number; sourceText: string } | { kind: "unknown"; sourceText: string };

/** Longest/most specific alternatives first is not required — the trailing `$` anchor forces
 *  a full match regardless of alternation order — but it reads more clearly this way. */
const ROOMS_PATTERN = new RegExp("^(.+?)\\s*(اتاق خواب|خوابه|خواب|اتاق)$");

export function parseRooms(rawText: string): RoomsParseResult {
  const sourceText = rawText;
  const working = normalizeDigits(normalizeText(rawText));

  const match = ROOMS_PATTERN.exec(working);
  if (!match) return { kind: "unknown", sourceText };

  const numberPart = match[1]!.trim();
  if (numberPart === "") return { kind: "unknown", sourceText };

  const digitValue = /^[0-9]+$/.test(numberPart) ? parseInteger(numberPart) : null;
  const bedrooms = digitValue ?? numberToSafeInteger(parseNumberWordsToBigInt(numberPart));

  if (bedrooms === null || bedrooms < 0) return { kind: "unknown", sourceText };

  return { kind: "exact", bedrooms, sourceText };
}

function numberToSafeInteger(value: bigint | null): number | null {
  if (value === null) return null;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}
