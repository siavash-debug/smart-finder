/**
 * `search_profile` repository.
 *
 * Every read here takes `userId` and filters by it in SQL — never fetches a profile by id
 * alone. That is the IDOR defence required by MASTER_PROMPT §24: a caller who only knows
 * another user's profile id gets `null`, indistinguishable from the id not existing at all,
 * not a row belonging to someone else.
 */

import { withTransaction } from "./pool.js";
import type { DatabaseClient, DatabasePool, Queryable } from "./pool.js";
import type { SearchProfileRow } from "./domain.js";

/**
 * Fields a caller may set when replacing the active profile. `userId`, `is_active`, and the
 * timestamps are owned by the repository, not the caller.
 */
export interface SearchProfileInput {
  transactionType: "sale";
  propertyType: "apartment";
  minPriceToman?: bigint;
  maxPriceToman?: bigint;
  minAreaSqm?: number;
  maxAreaSqm?: number;
  minRooms?: number;
  maxRooms?: number;
  minFloor?: number;
  maxFloor?: number;
  minBuildingAgeYears?: number;
  maxBuildingAgeYears?: number;
  /** Three-state: omitted/`undefined` means no preference — never coerced to `false`. */
  requireElevator?: boolean;
  requireParking?: boolean;
  requireStorage?: boolean;
  districtGeoAreaId?: string;
  neighborhoodGeoAreaId?: string;
  rawQueryText?: string;
  interpretationVersion?: string;
}

/**
 * `JSON.stringify` throws on `bigint` (price fields), so it cannot be handed a `SearchProfileRow`
 * directly. Money is rendered as a string, not a number, to avoid re-introducing float
 * imprecision into a stored snapshot (ADR-0005).
 */
function serializeSnapshot(row: SearchProfileRow): string {
  return JSON.stringify(row, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

export async function getActiveSearchProfile(
  pool: Queryable,
  userId: string,
): Promise<SearchProfileRow | null> {
  const { rows } = await pool.query<SearchProfileRow>(
    "SELECT * FROM search_profile WHERE user_id = $1 AND is_active LIMIT 1",
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * Fetches one profile by id, scoped to `userId`. This is the shape every user-facing lookup
 * in this repository must follow: a profile id from a URL or a request body is never trusted
 * on its own.
 */
export async function getSearchProfileById(
  pool: Queryable,
  userId: string,
  profileId: string,
): Promise<SearchProfileRow | null> {
  const { rows } = await pool.query<SearchProfileRow>(
    "SELECT * FROM search_profile WHERE id = $1 AND user_id = $2",
    [profileId, userId],
  );
  return rows[0] ?? null;
}

const INSERT_COLUMNS = `
  user_id, transaction_type, property_type,
  min_price_toman, max_price_toman, min_area_sqm, max_area_sqm,
  min_rooms, max_rooms, min_floor, max_floor,
  min_building_age_years, max_building_age_years,
  require_elevator, require_parking, require_storage,
  district_geo_area_id, neighborhood_geo_area_id,
  raw_query_text, interpretation_version
`;

function insertValues(userId: string, input: SearchProfileInput): unknown[] {
  return [
    userId,
    input.transactionType,
    input.propertyType,
    input.minPriceToman ?? null,
    input.maxPriceToman ?? null,
    input.minAreaSqm ?? null,
    input.maxAreaSqm ?? null,
    input.minRooms ?? null,
    input.maxRooms ?? null,
    input.minFloor ?? null,
    input.maxFloor ?? null,
    input.minBuildingAgeYears ?? null,
    input.maxBuildingAgeYears ?? null,
    input.requireElevator ?? null,
    input.requireParking ?? null,
    input.requireStorage ?? null,
    input.districtGeoAreaId ?? null,
    input.neighborhoodGeoAreaId ?? null,
    input.rawQueryText ?? null,
    input.interpretationVersion ?? null,
  ];
}

/**
 * Replaces the user's active profile (MVP: one active profile per user — MASTER_PROMPT §4).
 * The previous active profile, if any, is snapshotted into `search_profile_history` and
 * deactivated in the same transaction as the insert, so a crash between the two steps can
 * never leave two profiles simultaneously active or a snapshot silently missing.
 */
export async function replaceActiveSearchProfile(
  // Needs a real Pool, not just Queryable: it opens its own transaction via withTransaction.
  pool: DatabasePool,
  userId: string,
  input: SearchProfileInput,
): Promise<SearchProfileRow> {
  return withTransaction(pool, async (client: DatabaseClient) => {
    const { rows: activeRows } = await client.query<SearchProfileRow>(
      "SELECT * FROM search_profile WHERE user_id = $1 AND is_active LIMIT 1 FOR UPDATE",
      [userId],
    );
    const previous = activeRows[0];

    if (previous !== undefined) {
      await client.query(
        `INSERT INTO search_profile_history
           (search_profile_id, snapshot, raw_query_text, interpretation_version)
         VALUES ($1, $2::jsonb, $3, $4)`,
        [
          previous.id,
          serializeSnapshot(previous),
          previous.raw_query_text,
          previous.interpretation_version,
        ],
      );
      await client.query("UPDATE search_profile SET is_active = false WHERE id = $1", [
        previous.id,
      ]);
    }

    const { rows } = await client.query<SearchProfileRow>(
      `INSERT INTO search_profile (${INSERT_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING *`,
      insertValues(userId, input),
    );
    return rows[0]!;
  });
}

/**
 * Deactivates the user's active profile without replacing it — "stop notifying me" without
 * deleting the profile's history.
 */
export async function deactivateSearchProfile(
  pool: Queryable,
  userId: string,
  profileId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    "UPDATE search_profile SET is_active = false WHERE id = $1 AND user_id = $2 AND is_active",
    [profileId, userId],
  );
  return rowCount === 1;
}

export async function listSearchProfileHistory(
  pool: Queryable,
  userId: string,
  profileId: string,
): Promise<{ id: string; snapshot: unknown; changed_at: Date }[]> {
  // The join back to search_profile is what makes this user-scoped: a history row alone
  // carries no user_id of its own.
  const { rows } = await pool.query<{ id: string; snapshot: unknown; changed_at: Date }>(
    `SELECT h.id, h.snapshot, h.changed_at
     FROM search_profile_history h
     JOIN search_profile p ON p.id = h.search_profile_id
     WHERE h.search_profile_id = $1 AND p.user_id = $2
     ORDER BY h.changed_at DESC`,
    [profileId, userId],
  );
  return rows;
}
