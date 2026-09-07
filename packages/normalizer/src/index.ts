/**
 * Deterministic Persian real-estate text normalization and preference extraction
 * (MASTER_PROMPT §§1-16, Phase 2). No AI dependency anywhere in this package — see
 * `docs/DECISIONS.md` ADR-0012.
 */

export { normalizeText } from "./text.js";

export {
  normalizeDigits,
  parseDecimalLiteral,
  parseInteger,
  scaleDecimalToBigInt,
  type DecimalLiteral,
} from "./digits.js";

export { parseNumberWordsToBigInt, SCALE_WORDS } from "./number-words.js";

export { parseMoney, type MoneyParseResult } from "./money.js";

export { parseArea, type AreaComparator, type AreaParseResult } from "./area.js";

export { parseRooms, type RoomsParseResult } from "./rooms.js";

export { parseFloor, type FloorCategory, type FloorParseResult } from "./floor.js";

export { parseBuildingAge, type BuildingAgeResult } from "./building-age.js";

export {
  ATTRIBUTE_NOUNS,
  parseAllAttributes,
  parseAttribute,
  type AttributeName,
  type TriState,
} from "./attributes.js";

export {
  resolveGeoArea,
  type GeoAreaIdentity,
  type GeoAreaKind,
  type GeographyParseResult,
} from "./geography.js";

export {
  daysInJalaliMonth,
  gregorianToJalali,
  isLeapJalaliYear,
  isValidJalaliDate,
  jalaliToGregorian,
  type GregorianDate,
  type JalaliDate,
} from "./jalali.js";

export {
  extractPreferences,
  type AreaConstraint,
  type AttributePreference,
  type ExtractedPreferences,
  type PriceConstraint,
  type RangeConstraint,
} from "./preferences.js";
