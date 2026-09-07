/**
 * Public types for the deterministic matching engine (MASTER_PROMPT §9-§13, Phase 3).
 *
 * This package is pure and dependency-free — no database, network, or LLM (ADR-0007,
 * ADR-0014). It consumes an already-normalized snapshot, never raw text; re-parsing Persian
 * text is `packages/normalizer`'s job, not this one's.
 */

// ── Tri-state ────────────────────────────────────────────────────────────────────────────

/**
 * `true` / `false` / `null` (unknown). `null` must never be treated as `false` — the whole
 * point of a tri-state field is that "the source didn't say" is a different fact from "the
 * source said no" (MASTER_PROMPT §16, ADR-0007).
 */
export type TriState = boolean | null;

// ── Listing snapshot ─────────────────────────────────────────────────────────────────────

/**
 * The facts about one posting the matcher needs, already normalized (MASTER_PROMPT §4).
 * Every field is nullable — `null` means "unknown", never a guessed value. Field names and
 * units mirror the locked `posting` schema (migration `0002_core_schema.sql`) directly, so a
 * caller can build this from a `PostingRow` with no unit conversion.
 *
 * `floorCategory` has no backing database column yet (`posting.floor` is a plain integer —
 * see ADR-0014's "known gaps" section) — it exists here so the matcher can correctly handle
 * a category-classified floor (`ground`/`basement`/`penthouse`, from
 * `@smart-finder/normalizer`'s `parseFloor`) when a caller has one available, even though no
 * listing sourced purely from today's database will ever populate it.
 */
export interface MatchListingSnapshot {
  priceToman: bigint | null;
  areaSqm: number | null;
  rooms: number | null;
  /** Plain numeric floor. `null` if unknown OR if only a category (see `floorCategory`) is
   *  known — the two are never conflated (MASTER_PROMPT §18). */
  floor: number | null;
  /** `null` when the floor is a plain number (or unknown), not a special category. */
  floorCategory: "ground" | "basement" | "penthouse" | null;
  totalFloors: number | null;
  /** Relative age in years, matching `posting.building_age_years` — not a Jalali year (see
   *  ADR-0014's "construction year" section for why). */
  buildingAgeYears: number | null;
  hasParking: TriState;
  hasElevator: TriState;
  hasStorage: TriState;
  districtGeoAreaId: string | null;
  neighborhoodGeoAreaId: string | null;
}

// ── Profile snapshot ─────────────────────────────────────────────────────────────────────

/**
 * The buyer's requested constraints, mirroring the locked `search_profile` schema fields
 * directly (MASTER_PROMPT §5). A `null` bound means "no preference stated" for that bound —
 * not "zero" and not "any". `requireParking`/`requireElevator`/`requireStorage` are
 * themselves tri-state: `true` = required, `false` = explicitly must NOT have, `null` = not
 * requested (ADR-0014).
 */
export interface MatchProfileSnapshot {
  minPriceToman: bigint | null;
  maxPriceToman: bigint | null;
  minAreaSqm: number | null;
  maxAreaSqm: number | null;
  minRooms: number | null;
  maxRooms: number | null;
  minFloor: number | null;
  maxFloor: number | null;
  minBuildingAgeYears: number | null;
  maxBuildingAgeYears: number | null;
  requireParking: TriState;
  requireElevator: TriState;
  requireStorage: TriState;
  districtGeoAreaId: string | null;
  neighborhoodGeoAreaId: string | null;
}

// ── Criteria and violations ──────────────────────────────────────────────────────────────

export type CriterionStatus = "matched" | "mismatch" | "unknown" | "not_applicable";

/**
 * One evaluated fact about the listing relative to the profile. `explanation` is always a
 * structured statement of fact, never a value judgement (MASTER_PROMPT §26) — no "great
 * deal", no "probably undervalued". It is plain English here; a UI localizes it to Persian
 * from the structured fields (`key`, `status`, `requested`, `actual`), not by translating
 * this string.
 */
export interface MatchCriterion {
  key: string;
  status: CriterionStatus;
  requested?: unknown;
  actual?: unknown;
  explanation: string;
}

export type ViolationSeverity = "hard" | "soft";

/** A confirmed problem — never emitted for `unknown` (MASTER_PROMPT §7-§8: an unknown value
 *  is never a confirmed violation). */
export interface MatchViolation {
  key: string;
  severity: ViolationSeverity;
  requested?: unknown;
  actual?: unknown;
  reason: string;
}

// ── Tiers ─────────────────────────────────────────────────────────────────────────────────

/**
 * Three tiers, lowercase, per this phase's explicit instructions. `MASTER_PROMPT.md` §10 and
 * the already-migrated `match.tier` CHECK constraint (migration `0002_core_schema.sql`) both
 * name a fourth tier, `WEAK`, uppercase — a real, already-locked discrepancy this phase does
 * not resolve; see ADR-0014's "known gaps" section. This package's public tier values are
 * exactly `exact` / `strong` / `near` and nothing else.
 */
export type MatchTier = "exact" | "strong" | "near";

// ── Result ───────────────────────────────────────────────────────────────────────────────

export interface MatchResult {
  /** Bounded integer, `0 <= total <= 100`. Secondary to `tier` — never overrides a hard
   *  violation's effect on tier, and never displayed as false precision like "94.37%". */
  total: number;
  tier: MatchTier;
  criteria: MatchCriterion[];
  violations: MatchViolation[];
}
