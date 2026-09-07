/**
 * Pure `SourceAdapter.normalize` stage for Divar: turns `ParsedDivarFields`'s raw strings into
 * domain-shaped fields via `@smart-finder/normalizer`. Never invents a value — every field
 * that doesn't parse cleanly comes out `undefined` (schema's `null`), matching the normalizer's
 * own unknown-over-guess discipline.
 */

import {
  gregorianToJalali,
  parseAllAttributes,
  parseBuildingAge,
  parseFloor,
  parseInteger,
  parseMoney,
} from "@smart-finder/normalizer";

import type { ListingContext, NormalizedListingFields } from "../types.js";
import type { ParsedDivarFields } from "./types.js";

function undefinedIfNull<T>(value: T | null): T | undefined {
  return value ?? undefined;
}

/**
 * Divar states an absolute Jalali construction year ("ساخت ۱۳۹۵"); the schema stores a
 * relative age in years. The conversion needs a "now" to be relative to, so `referenceDate` is
 * an explicit parameter — never a hidden `Date.now()` read — keeping this function
 * deterministic and testable, consistent with the rest of the normalizer's design.
 */
function buildingAgeYearsFromRaw(raw: string | null, referenceDate: Date): number | undefined {
  if (raw === null) return undefined;
  const parsed = parseBuildingAge(`ساخت ${raw}`);
  if (parsed.kind === "new_construction") return 0;
  if (parsed.kind === "relative_age") return parsed.years;
  if (parsed.kind !== "year") return undefined;

  const currentJalali = gregorianToJalali(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth() + 1,
    referenceDate.getUTCDate(),
  );
  if (currentJalali === null) return undefined;

  const age = currentJalali.year - parsed.jalaliYear;
  return age >= 0 ? age : undefined; // a "construction year" in the future is not a real age
}

function priceFromRaw(raw: string | null): bigint | undefined {
  if (raw === null) return undefined;
  const parsed = parseMoney(raw);
  return parsed.kind === "exact" ? parsed.amountToman : undefined;
}

function floorFromRaw(raw: string | null): { floor?: number; totalFloors?: number } {
  if (raw === null) return {};
  const parsed = parseFloor(raw);
  if (parsed.kind !== "numeric") return {};
  return {
    floor: parsed.floor,
    ...(parsed.totalFloors !== null ? { totalFloors: parsed.totalFloors } : {}),
  };
}

/**
 * متراژ/اتاق are bare digit strings ("۱۱۰", "۲") — `parseArea`/`parseRooms` require an
 * explicit unit word ("متر", "خواب"/"اتاق") specifically to avoid guessing at free text, but
 * Divar's own table label already disambiguates the field unambiguously, so that guard doesn't
 * apply here. `parseInteger` (not `parseArea`/`parseRooms`) is deliberately used instead — a
 * documented deviation, not an oversight.
 */
function integerFromRaw(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const value = parseInteger(raw);
  return value ?? undefined;
}

export function normalizeDivarFields(
  parsed: ParsedDivarFields,
  context: ListingContext,
  referenceDate: Date,
): NormalizedListingFields {
  const attributes = parseAllAttributes(parsed.amenitiesText);
  const { floor, totalFloors } = floorFromRaw(parsed.floorRaw);

  const title = undefinedIfNull(parsed.title);
  const description = undefinedIfNull(parsed.description);
  const priceToman = priceFromRaw(parsed.priceRaw);
  const areaSqm = integerFromRaw(parsed.areaRaw);
  const rooms = integerFromRaw(parsed.roomsRaw);
  const buildingAgeYears = buildingAgeYearsFromRaw(parsed.buildingAgeYearRaw, referenceDate);
  const hasElevator = attributes.elevator ?? undefined;
  const hasParking = attributes.parking ?? undefined;
  const hasStorage = attributes.storage ?? undefined;

  return {
    ...context,
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(priceToman !== undefined ? { priceToman } : {}),
    ...(areaSqm !== undefined ? { areaSqm } : {}),
    ...(rooms !== undefined ? { rooms } : {}),
    ...(floor !== undefined ? { floor } : {}),
    ...(totalFloors !== undefined ? { totalFloors } : {}),
    ...(buildingAgeYears !== undefined ? { buildingAgeYears } : {}),
    ...(hasElevator !== undefined ? { hasElevator } : {}),
    ...(hasParking !== undefined ? { hasParking } : {}),
    ...(hasStorage !== undefined ? { hasStorage } : {}),
  };
}
