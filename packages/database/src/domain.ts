/**
 * Row shapes for the tables that have a repository.
 *
 * Fields are named exactly as their columns — this package deliberately has no ORM and no
 * camelCase mapping layer (ARCHITECTURE §9), so a row type is just the table read straight
 * through. `bigint` fields come back as `bigint` because of the `int8` type parser installed
 * in `pool.ts` (ADR-0005).
 *
 * `app_user`, `search_profile`, `job` (Phase 1), `notification` and `telegram_command_log`
 * (Phase 4), and now `source`, `collection_run`, `posting`, and `posting_version` (Phase 5)
 * have repositories. The remaining entities from MASTER_PROMPT §8 get theirs when the phase
 * that first consumes them arrives (ADR-0011), same reasoning as the package layout in
 * ADR-0008.
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

export type NotificationChannel = "telegram";
export type NotificationStatus = "pending" | "sent" | "failed" | "suppressed";

export interface NotificationRow {
  id: string;
  user_id: string;
  match_id: string | null;
  posting_id: string | null;
  channel: NotificationChannel;
  template: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  status: NotificationStatus;
  attempts: number;
  last_error: string | null;
  scheduled_for: Date;
  sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface TelegramCommandLogRow {
  id: string;
  telegram_user_id: bigint;
  command: string;
  created_at: Date;
}

export interface SourceRow {
  id: string;
  slug: string;
  display_name: string;
  base_url: string;
  enabled: boolean;
  robots_txt_checked_at: Date | null;
  created_at: Date;
}

export type CollectionRunStatus = "running" | "completed" | "failed";

export interface CollectionRunRow {
  id: string;
  source_id: string;
  status: CollectionRunStatus;
  started_at: Date;
  finished_at: Date | null;
  postings_seen: number;
  postings_new: number;
  postings_updated: number;
  error_message: string | null;
  created_at: Date;
}

export type PostingStatus = "active" | "delisted" | "unknown";

export interface PostingRow {
  id: string;
  source_id: string;
  source_posting_id: string;
  property_id: string | null;
  property_confidence: number | null;
  transaction_type: TransactionType;
  property_type: PropertyType;
  title: string | null;
  description: string | null;
  price_toman: bigint | null;
  area_sqm: number | null;
  rooms: number | null;
  floor: number | null;
  total_floors: number | null;
  building_age_years: number | null;
  has_elevator: boolean | null;
  has_parking: boolean | null;
  has_storage: boolean | null;
  district_geo_area_id: string | null;
  neighborhood_geo_area_id: string | null;
  raw_address: string | null;
  content_hash: string;
  status: PostingStatus;
  first_seen_at: Date;
  last_seen_at: Date;
  delisted_at: Date | null;
  last_collection_run_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PostingVersionRow {
  id: string;
  posting_id: string;
  content_hash: string;
  price_toman: bigint | null;
  area_sqm: number | null;
  rooms: number | null;
  floor: number | null;
  title: string | null;
  description: string | null;
  has_elevator: boolean | null;
  has_parking: boolean | null;
  has_storage: boolean | null;
  raw_payload: Record<string, unknown> | null;
  collection_run_id: string | null;
  observed_at: Date;
  created_at: Date;
}
