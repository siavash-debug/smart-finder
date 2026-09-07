/**
 * Tehran geography alias resolution (MASTER_PROMPT §9).
 *
 * This is deliberately a small, maintainable, in-memory seed list — not a speculative
 * database (§9: "do not create a huge speculative geography database"). It resolves a
 * *single, already-isolated* area name (e.g. "سعادت‌آباد", extracted by a caller like
 * `preferences.ts` from a phrase such as "در سعادت‌آباد") to a canonical identity. It does
 * not scan a whole free-text sentence itself — that responsibility, and any future extension
 * through the database's `source_area_alias` → `geo_area` tables (Phase 1 schema), belongs to
 * the caller. This module has no database dependency, matching `packages/matching`'s
 * "pure, dependency-free" precedent (ARCHITECTURE §9).
 *
 * Spelling variation from spacing, ZWNJ, and Arabic/Persian character forms is already
 * handled by `normalizeText` before lookup — most of what's left to seed explicitly here is
 * genuine alternate spellings (a space where the canonical form has none) and common
 * abbreviations/nicknames.
 */

import { normalizeDigits } from "./digits.js";
import { normalizeText } from "./text.js";

/** Character forms and digit script, together — district aliases ("منطقه ۲") mix both. */
function normalizeKey(text: string): string {
  return normalizeDigits(normalizeText(text));
}

export type GeoAreaKind = "district" | "neighborhood";

export interface GeoAreaIdentity {
  kind: GeoAreaKind;
  /** The canonical, normalized spelling — what gets stored/matched against, not necessarily
   *  the prettiest display form. */
  canonicalName: string;
}

export type GeographyParseResult =
  | { kind: "known"; area: GeoAreaIdentity; sourceText: string }
  | { kind: "unknown"; sourceText: string };

interface SeedArea {
  canonicalName: string;
  kind: GeoAreaKind;
  /** Alternate spellings that resolve to this entry. The canonical name is always included
   *  automatically — it does not need to repeat itself here. */
  aliases: readonly string[];
}

/**
 * A starting set of well-known Tehran neighborhoods and districts. Extend this list as real
 * `source_area_alias` data (Phase 1 schema) reveals what buyers and Divar listings actually
 * use — do not pre-populate speculatively beyond what's genuinely common and confidently
 * known (§9).
 */
const SEED_AREAS: readonly SeedArea[] = [
  { canonicalName: "سعادت‌آباد", kind: "neighborhood", aliases: ["سعادت آباد"] },
  { canonicalName: "پونک", kind: "neighborhood", aliases: [] },
  { canonicalName: "جردن", kind: "neighborhood", aliases: [] },
  { canonicalName: "ونک", kind: "neighborhood", aliases: [] },
  { canonicalName: "نیاوران", kind: "neighborhood", aliases: [] },
  { canonicalName: "الهیه", kind: "neighborhood", aliases: [] },
  { canonicalName: "زعفرانیه", kind: "neighborhood", aliases: [] },
  { canonicalName: "تجریش", kind: "neighborhood", aliases: [] },
  { canonicalName: "پاسداران", kind: "neighborhood", aliases: [] },
  { canonicalName: "شهرک غرب", kind: "neighborhood", aliases: ["شهرک قرب"] },
  { canonicalName: "اکباتان", kind: "neighborhood", aliases: [] },
  { canonicalName: "یوسف‌آباد", kind: "neighborhood", aliases: ["یوسف آباد"] },
  { canonicalName: "گیشا", kind: "neighborhood", aliases: ["کوی نصر"] },
  { canonicalName: "ولنجک", kind: "neighborhood", aliases: [] },
  { canonicalName: "فرمانیه", kind: "neighborhood", aliases: [] },
];

/** Tehran's 22 municipal districts, referred to as "منطقه N". */
function districtSeedAreas(): SeedArea[] {
  const areas: SeedArea[] = [];
  for (let n = 1; n <= 22; n += 1) {
    areas.push({
      canonicalName: `منطقه ${n}`,
      kind: "district",
      aliases: [`منطقه ${n} تهران`],
    });
  }
  return areas;
}

const ALIAS_INDEX = new Map<string, GeoAreaIdentity>();
for (const seed of [...SEED_AREAS, ...districtSeedAreas()]) {
  const identity: GeoAreaIdentity = { kind: seed.kind, canonicalName: seed.canonicalName };
  ALIAS_INDEX.set(normalizeKey(seed.canonicalName), identity);
  for (const alias of seed.aliases) {
    ALIAS_INDEX.set(normalizeKey(alias), identity);
  }
}

/**
 * Resolves one already-isolated area name to its canonical identity. Returns `unknown` — not
 * a guess — for anything not in the seed list, including a plausible-sounding but unrecognized
 * neighborhood name.
 */
export function resolveGeoArea(rawText: string): GeographyParseResult {
  const sourceText = rawText;
  const normalized = normalizeKey(rawText);
  if (normalized === "") return { kind: "unknown", sourceText };

  const area = ALIAS_INDEX.get(normalized);
  if (area === undefined) return { kind: "unknown", sourceText };

  return { kind: "known", area, sourceText };
}
