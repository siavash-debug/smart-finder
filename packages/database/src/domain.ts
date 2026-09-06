/**
 * Row shapes for the tables introduced in migration 0002 that already have a repository.
 *
 * Fields are named exactly as their columns — this package deliberately has no ORM and no
 * camelCase mapping layer (ARCHITECTURE §9), so a row type is just the table read straight
 * through. `bigint` fields come back as `bigint` because of the `int8` type parser installed
 * in `pool.ts` (ADR-0005).
 *
 * Only `app_user`, `search_profile`, and `job` have repositories so far. The remaining
 * entities from MASTER_PROMPT §8 get theirs when the phase that first consumes them arrives
 * (ADR-0011), same reasoning as the package layout in ADR-0008.
 */

export interface AppUserRow {
  id: string;
  telegram_user_id: bigint;
  telegram_username: string | null;
  display_name: string | null;
  created_at: Date;
  updated_at: Date;
}

export type TransactionType = "sale";
export type PropertyType = "apartment";

export interface SearchProfileRow {
  id: string;
  user_id: string;

  transaction_type: TransactionType;
  property_type: PropertyType;

  min_price_toman: bigint | null;
  max_price_toman: bigint | null;
  min_area_sqm: number | null;
  max_area_sqm: number | null;
  min_rooms: number | null;
  max_rooms: number | null;
  min_floor: number | null;
  max_floor: number | null;
  min_building_age_years: number | null;
  max_building_age_years: number | null;

  /** Three-state: `null` means no preference, never "false". */
  require_elevator: boolean | null;
  require_parking: boolean | null;
  require_storage: boolean | null;

  district_geo_area_id: string | null;
  neighborhood_geo_area_id: string | null;

  raw_query_text: string | null;
  interpretation_version: string | null;

  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface JobRow {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  run_at: Date;
  locked_at: Date | null;
  locked_by: string | null;
  run_id: string | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}
