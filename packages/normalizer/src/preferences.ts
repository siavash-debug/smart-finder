/**
 * Deterministic preference extraction (MASTER_PROMPT §12) — NOT an LLM feature. Every field
 * here comes from an explicit, rule-based match against the input text; nothing is inferred
 * or guessed. Three states matter throughout: explicitly requested, explicitly forbidden, and
 * unknown/not-mentioned — plus, for boolean attributes, an explicit "no preference" state
 * distinct from "unknown" (§13: "پارکینگ مهم نیست" must not become `parking = false`, and must
 * not collapse into plain "not mentioned" either — the buyer *did* say something, just that it
 * doesn't matter).
 *
 * The input is split on commas into clauses first ("تا ۶ میلیارد، حداقل ۱۰۰ متر، دو خواب،
 * پارکینگ حتماً" → four clauses). This is deliberate, not just convenient: it's what makes
 * every sub-parser's exact-match grammar (money, area, rooms) work directly against real
 * multi-clause sentences without those parsers ever seeing a stray trailing comma glued onto
 * their last token. Splitting on "و" instead would be wrong — "و" is part of money's own
 * compound grammar ("۵ میلیارد و ۲۰۰ میلیون" must stay one clause).
 */

import { normalizeDigits } from "./digits.js";
import { parseArea } from "./area.js";
import { ATTRIBUTE_NOUNS, parseAttribute, type AttributeName } from "./attributes.js";
import { parseBuildingAge } from "./building-age.js";
import { parseFloor } from "./floor.js";
import type { GeoAreaIdentity } from "./geography.js";
import { resolveGeoArea } from "./geography.js";
import { parseMoney } from "./money.js";
import { parseRooms } from "./rooms.js";
import { normalizeText } from "./text.js";

export type AttributePreference = "required" | "forbidden" | "no_preference" | "unknown";

export interface RangeConstraint<T> {
  min: T | null;
  max: T | null;
}

export interface PriceConstraint extends RangeConstraint<bigint> {
  approximate: boolean;
}

export interface AreaConstraint extends RangeConstraint<number> {
  approximate: boolean;
}

export interface ExtractedPreferences {
  price: PriceConstraint;
  area: AreaConstraint;
  bedrooms: RangeConstraint<number>;
  floor: RangeConstraint<number>;
  /** Jalali years. A relative-age or new-construction statement ("۵ ساله", "نوساز") is not
   *  resolved into a year here — see `building-age.ts` for why — so it does not appear in this
   *  structure; only an explicit construction year contributes to it. */
  buildingYear: RangeConstraint<number>;
  parking: AttributePreference;
  elevator: AttributePreference;
  storage: AttributePreference;
  balcony: AttributePreference;
  district: GeoAreaIdentity | null;
  rawText: string;
}

function emptyPreferences(rawText: string): ExtractedPreferences {
  return {
    price: { min: null, max: null, approximate: false },
    area: { min: null, max: null, approximate: false },
    bedrooms: { min: null, max: null },
    floor: { min: null, max: null },
    buildingYear: { min: null, max: null },
    parking: "unknown",
    elevator: "unknown",
    storage: "unknown",
    balcony: "unknown",
    district: null,
    rawText,
  };
}

function splitIntoClauses(text: string): string[] {
  return normalizeText(text)
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "");
}

function stripLeading(
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

const AT_LEAST_KEYWORDS = ["حداقل"];
const AT_MOST_KEYWORDS = ["حداکثر", "تا"];
const RANGE_TOKEN = "تا";

/**
 * A real buyer sentence rarely dedicates a whole comma-separated clause to a single field —
 * MASTER_PROMPT §14's own example, "یه آپارتمان ۹۰ تا ۱۱۰ متری دو خوابه توی سعادت‌آباد
 * می‌خوام، ...", has the area, room count, and district all sharing one clause with ordinary
 * sentence text around them. Rather than requiring a sub-parser's exact grammar to match an
 * entire clause, this tries every contiguous token window within it — longest first at each
 * starting position, scanning left to right — and returns the first window `parse` accepts.
 * Bounded to `maxWindowTokens` so this stays cheap for a normal sentence length.
 */
function findWindowMatch<T>(
  tokens: readonly string[],
  parse: (candidate: string) => T | null,
  maxWindowTokens = 6,
): T | null {
  for (let start = 0; start < tokens.length; start += 1) {
    const longest = Math.min(maxWindowTokens, tokens.length - start);
    for (let length = longest; length >= 1; length -= 1) {
      const candidate = tokens.slice(start, start + length).join(" ");
      const result = parse(candidate);
      if (result !== null) return result;
    }
  }
  return null;
}

function clauseTokens(clause: string): string[] {
  return normalizeDigits(normalizeText(clause)).split(" ").filter(Boolean);
}

function parsePriceCandidate(candidate: string): PriceConstraint | null {
  const atLeast = stripLeading(candidate, AT_LEAST_KEYWORDS);
  if (atLeast.matched) {
    const money = parseMoney(atLeast.text);
    if (money.kind !== "exact") return null;
    return { min: money.amountToman, max: null, approximate: money.approximate };
  }

  const atMost = stripLeading(candidate, AT_MOST_KEYWORDS);
  if (atMost.matched) {
    const money = parseMoney(atMost.text);
    if (money.kind === "exact")
      return { min: null, max: money.amountToman, approximate: money.approximate };
    if (money.kind === "range")
      return { min: money.minToman, max: money.maxToman, approximate: money.approximate };
    return null;
  }

  const money = parseMoney(candidate);
  if (money.kind === "range") {
    return { min: money.minToman, max: money.maxToman, approximate: money.approximate };
  }
  // A bare, keyword-less exact amount ("۵ میلیارد" with no "تا"/"حداقل"/"حداکثر") is genuinely
  // ambiguous as to buyer intent — a ceiling, a target, or just market context — and is left
  // unrecorded rather than guessed, unlike area/rooms below where a bare mention conventionally
  // reads as the buyer's exact target.
  return null;
}

function extractPriceClause(clause: string): PriceConstraint | null {
  return findWindowMatch(clauseTokens(clause), parsePriceCandidate);
}

function parseAreaCandidate(candidate: string): AreaConstraint | null {
  const tokens = candidate.split(" ").filter(Boolean);
  const rangeIndex = tokens.indexOf(RANGE_TOKEN);
  if (rangeIndex > 0 && rangeIndex < tokens.length - 1) {
    const rightText = tokens.slice(rangeIndex + 1).join(" ");
    const rightArea = parseArea(rightText);
    if (rightArea.kind !== "exact") return null;

    const leftText = tokens.slice(0, rangeIndex).join(" ");
    let leftArea = parseArea(leftText);
    if (leftArea.kind !== "exact") {
      // The left side of a range commonly omits the unit ("۹۰ تا ۱۱۰ متر") — borrow the
      // right side's unit rather than requiring it to be repeated.
      leftArea = parseArea(`${leftText} متر`);
    }
    if (leftArea.kind !== "exact") return null;
    return { min: leftArea.sqm, max: rightArea.sqm, approximate: false };
  }

  const atLeast = stripLeading(candidate, AT_LEAST_KEYWORDS);
  if (atLeast.matched) {
    const area = parseArea(atLeast.text);
    if (area.kind !== "exact") return null;
    return { min: area.sqm, max: null, approximate: area.approximate };
  }

  const atMost = stripLeading(candidate, ["حداکثر"]);
  if (atMost.matched) {
    const area = parseArea(atMost.text);
    if (area.kind !== "exact") return null;
    return { min: null, max: area.sqm, approximate: area.approximate };
  }

  const area = parseArea(candidate);
  if (area.kind !== "exact") return null;
  if (area.comparator === "at_least")
    return { min: area.sqm, max: null, approximate: area.approximate };
  if (area.comparator === "at_most")
    return { min: null, max: area.sqm, approximate: area.approximate };
  // A bare area statement conventionally states the buyer's exact target, not just a floor.
  return { min: area.sqm, max: area.sqm, approximate: area.approximate };
}

function extractAreaClause(clause: string): AreaConstraint | null {
  return findWindowMatch(clauseTokens(clause), parseAreaCandidate);
}

function parseRoomsCandidate(candidate: string): RangeConstraint<number> | null {
  const atLeast = stripLeading(candidate, AT_LEAST_KEYWORDS);
  if (atLeast.matched) {
    const rooms = parseRooms(atLeast.text);
    if (rooms.kind !== "exact") return null;
    return { min: rooms.bedrooms, max: null };
  }

  const rooms = parseRooms(candidate);
  if (rooms.kind !== "exact") return null;
  return { min: rooms.bedrooms, max: rooms.bedrooms };
}

function extractRoomsClause(clause: string): RangeConstraint<number> | null {
  return findWindowMatch(clauseTokens(clause), parseRoomsCandidate);
}

function parseFloorCandidate(candidate: string): RangeConstraint<number> | null {
  const floor = parseFloor(candidate);
  if (floor.kind !== "numeric") return null;
  return { min: floor.floor, max: floor.floor };
}

function extractFloorClause(clause: string): RangeConstraint<number> | null {
  return findWindowMatch(clauseTokens(clause), parseFloorCandidate);
}

function parseBuildingYearCandidate(candidate: string): RangeConstraint<number> | null {
  const age = parseBuildingAge(candidate);
  if (age.kind !== "year") return null;
  return { min: age.jalaliYear, max: age.jalaliYear };
}

function extractBuildingYearClause(clause: string): RangeConstraint<number> | null {
  return findWindowMatch(clauseTokens(clause), parseBuildingYearCandidate);
}

const DONT_CARE_PHRASES = ["مهم نیست", "فرقی نداره", "فرقی نمی‌کند", "فرقی نمیکند", "فرقی نمی کند"];

function extractAttributePreference(attribute: AttributeName, clause: string): AttributePreference {
  const normalized = normalizeText(clause);
  const mentionsNoun = ATTRIBUTE_NOUNS[attribute].some((noun) => normalized.includes(noun));
  if (!mentionsNoun) return "unknown";

  if (DONT_CARE_PHRASES.some((phrase) => normalized.includes(phrase))) return "no_preference";

  const value = parseAttribute(attribute, clause);
  if (value === null) return "unknown"; // mentioned, but contradictory — insufficient confidence
  return value ? "required" : "forbidden";
}

const DISTRICT_MARKERS = new Set(["در", "تو", "توی"]);
/** The longest seed area name is two tokens ("شهرک غرب", "منطقه N تهران"). */
const MAX_DISTRICT_NAME_TOKENS = 3;

/**
 * Unlike the other extractors, the location marker ("در"/"تو"/"توی") must be found first —
 * the area name itself is whatever comes immediately after it, tried at a few lengths to
 * cover multi-word names, not the other way around.
 */
function extractDistrictClause(clause: string): GeoAreaIdentity | null {
  const tokens = clauseTokens(clause);
  for (let i = 0; i < tokens.length; i += 1) {
    if (!DISTRICT_MARKERS.has(tokens[i]!)) continue;
    const remaining = tokens.length - (i + 1);
    for (let length = Math.min(MAX_DISTRICT_NAME_TOKENS, remaining); length >= 1; length -= 1) {
      const candidate = tokens.slice(i + 1, i + 1 + length).join(" ");
      const result = resolveGeoArea(candidate);
      if (result.kind === "known") return result.area;
    }
  }
  return null;
}

/**
 * Extracts a structured preference specification from free Persian text. Nothing here is
 * invented: a field stays at its zero value (`null` / `"unknown"`) unless a clause explicitly
 * justifies setting it (MASTER_PROMPT §16 — "if not justified, return unknown").
 */
export function extractPreferences(rawText: string): ExtractedPreferences {
  const result = emptyPreferences(rawText);
  const clauses = splitIntoClauses(rawText);

  for (const clause of clauses) {
    const price = extractPriceClause(clause);
    if (price) result.price = price;

    const area = extractAreaClause(clause);
    if (area) result.area = area;

    const rooms = extractRoomsClause(clause);
    if (rooms) result.bedrooms = rooms;

    const floor = extractFloorClause(clause);
    if (floor) result.floor = floor;

    const buildingYear = extractBuildingYearClause(clause);
    if (buildingYear) result.buildingYear = buildingYear;

    const district = extractDistrictClause(clause);
    if (district) result.district = district;

    const parking = extractAttributePreference("parking", clause);
    if (parking !== "unknown") result.parking = parking;

    const elevator = extractAttributePreference("elevator", clause);
    if (elevator !== "unknown") result.elevator = elevator;

    const storage = extractAttributePreference("storage", clause);
    if (storage !== "unknown") result.storage = storage;

    const balcony = extractAttributePreference("balcony", clause);
    if (balcony !== "unknown") result.balcony = balcony;
  }

  return result;
}
