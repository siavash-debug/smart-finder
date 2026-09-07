/**
 * `posting` / `posting_version` repository (Phase 5). The core operation is
 * `upsertPosting`: given a source posting's freshly-normalized fields and a content hash, it
 * decides — deterministically, from the stored `content_hash` alone — whether this is a
 * brand-new posting, an unchanged re-observation, or a changed one, and does exactly the
 * right thing for each:
 *
 *  - **new**: insert the `posting` row, insert one `posting_version` row.
 *  - **unchanged**: touch `last_seen_at`/`last_collection_run_id` only. No new version row —
 *    an unchanged re-observation is not "history", it would just be noise.
 *  - **changed**: update the `posting` row to the new values, insert one *new*
 *    `posting_version` row. The posting's identity (its `id`) never changes — MASTER_PROMPT
 *    §21/§29: "do not create a new posting identity merely because the price or description
 *    changed", and the previous version's row is never touched, only appended after
 *    (`posting_version` is append-only, migration `0002_core_schema.sql`).
 *
 * All of this happens inside one transaction per posting, so a crash between the `posting`
 * update and the `posting_version` insert can never happen.
 */

import type { PostingRow, PostingVersionRow, TransactionType, PropertyType } from "./domain.js";
import { withTransaction, type DatabaseClient, type DatabasePool } from "./pool.js";

export interface UpsertPostingInput {
  sourceId: string;
  sourcePostingId: string;
  transactionType: TransactionType;
  propertyType: PropertyType;
  title?: string;
  description?: string;
  priceToman?: bigint;
  areaSqm?: number;
  rooms?: number;
  floor?: number;
  totalFloors?: number;
  buildingAgeYears?: number;
  hasElevator?: boolean;
  hasParking?: boolean;
  hasStorage?: boolean;
  districtGeoAreaId?: string;
  neighborhoodGeoAreaId?: string;
  rawAddress?: string;
  /** A deterministic hash of every field above that counts as "meaningful content" — computed
   *  by the caller (the adapter/normalizer layer), not this repository, so the hashing
   *  algorithm stays a single well-tested, callable-in-isolation function. */
  contentHash: string;
  /** For `raw_payload` on the `posting_version` row — whatever the adapter judges useful to
   *  keep for debugging a future extraction change. Never the full raw HTML (privacy/size). */
  rawPayload?: Record<string, unknown>;
  collectionRunId?: string;
}

export type PostingChangeKind = "new" | "unchanged" | "changed";

export interface UpsertPostingResult {
  posting: PostingRow;
  change: PostingChangeKind;
}

const UPDATABLE_FIELDS = `
  title = $2, description = $3, price_toman = $4, area_sqm = $5, rooms = $6,
  floor = $7, total_floors = $8, building_age_years = $9,
  has_elevator = $10, has_parking = $11, has_storage = $12,
  district_geo_area_id = $13, neighborhood_geo_area_id = $14, raw_address = $15,
  content_hash = $16, status = 'active', last_seen_at = now(), last_collection_run_id = $17
`;

function fieldValues(input: UpsertPostingInput): unknown[] {
  return [
    input.title ?? null,
    input.description ?? null,
    input.priceToman ?? null,
    input.areaSqm ?? null,
    input.rooms ?? null,
    input.floor ?? null,
    input.totalFloors ?? null,
    input.buildingAgeYears ?? null,
    input.hasElevator ?? null,
    input.hasParking ?? null,
    input.hasStorage ?? null,
    input.districtGeoAreaId ?? null,
    input.neighborhoodGeoAreaId ?? null,
    input.rawAddress ?? null,
    input.contentHash,
    input.collectionRunId ?? null,
  ];
}

async function insertPostingVersion(
  client: DatabaseClient,
  postingId: string,
  input: UpsertPostingInput,
): Promise<PostingVersionRow> {
  const { rows } = await client.query<PostingVersionRow>(
    `INSERT INTO posting_version
       (posting_id, content_hash, price_toman, area_sqm, rooms, floor, title, description,
        has_elevator, has_parking, has_storage, raw_payload, collection_run_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      postingId,
      input.contentHash,
      input.priceToman ?? null,
      input.areaSqm ?? null,
      input.rooms ?? null,
      input.floor ?? null,
      input.title ?? null,
      input.description ?? null,
      input.hasElevator ?? null,
      input.hasParking ?? null,
      input.hasStorage ?? null,
      input.rawPayload ?? null,
      input.collectionRunId ?? null,
    ],
  );
  return rows[0]!;
}

export async function upsertPosting(
  pool: DatabasePool,
  input: UpsertPostingInput,
): Promise<UpsertPostingResult> {
  return withTransaction(pool, async (client) => {
    const { rows: existingRows } = await client.query<PostingRow>(
      "SELECT * FROM posting WHERE source_id = $1 AND source_posting_id = $2 FOR UPDATE",
      [input.sourceId, input.sourcePostingId],
    );
    const existing = existingRows[0];

    if (existing === undefined) {
      const { rows } = await client.query<PostingRow>(
        `INSERT INTO posting
           (source_id, source_posting_id, transaction_type, property_type,
            title, description, price_toman, area_sqm, rooms, floor, total_floors,
            building_age_years, has_elevator, has_parking, has_storage,
            district_geo_area_id, neighborhood_geo_area_id, raw_address,
            content_hash, last_collection_run_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
         RETURNING *`,
        [
          input.sourceId,
          input.sourcePostingId,
          input.transactionType,
          input.propertyType,
          ...fieldValues(input),
        ],
      );
      const posting = rows[0]!;
      await insertPostingVersion(client, posting.id, input);
      return { posting, change: "new" as const };
    }

    if (existing.content_hash === input.contentHash) {
      const { rows } = await client.query<PostingRow>(
        `UPDATE posting SET status = 'active', last_seen_at = now(), last_collection_run_id = $2
         WHERE id = $1 RETURNING *`,
        [existing.id, input.collectionRunId ?? null],
      );
      return { posting: rows[0]!, change: "unchanged" as const };
    }

    const { rows } = await client.query<PostingRow>(
      `UPDATE posting SET ${UPDATABLE_FIELDS} WHERE id = $1 RETURNING *`,
      [existing.id, ...fieldValues(input)],
    );
    const posting = rows[0]!;
    await insertPostingVersion(client, posting.id, input);
    return { posting, change: "changed" as const };
  });
}

export async function getPostingBySourceId(
  pool: DatabasePool,
  sourceId: string,
  sourcePostingId: string,
): Promise<PostingRow | null> {
  const { rows } = await pool.query<PostingRow>(
    "SELECT * FROM posting WHERE source_id = $1 AND source_posting_id = $2",
    [sourceId, sourcePostingId],
  );
  return rows[0] ?? null;
}

export async function getPostingVersions(
  pool: DatabasePool,
  postingId: string,
): Promise<PostingVersionRow[]> {
  const { rows } = await pool.query<PostingVersionRow>(
    "SELECT * FROM posting_version WHERE posting_id = $1 ORDER BY observed_at DESC",
    [postingId],
  );
  return rows;
}

/**
 * Marks `active` postings from `sourceId` that were *not* touched by `collectionRunId` as
 * `delisted`. Only ever call this after the owning `collection_run` is marked `completed` —
 * a failed/partial run must never cause a false delisting (MASTER_PROMPT §22).
 *
 * Correct only when `collectionRunId` covers the *entire* active catalog for `sourceId` —
 * otherwise every posting outside that run's bounded scope gets wrongly delisted merely for
 * not having been re-visited yet. Phase 5's own collection runs are deliberately small and
 * bounded (MASTER_PROMPT §5/spike guidance: no large-scale scraping yet), so
 * `apps/worker`'s Phase 5 job handler does not call this function — a correct full-catalog
 * sweep is future work, not this phase's. Provided and tested now so it's ready once that
 * exists, not invented ad hoc later without a test.
 */
export async function delistUntouchedPostings(
  pool: DatabasePool,
  sourceId: string,
  collectionRunId: string,
): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE posting
     SET status = 'delisted', delisted_at = now()
     WHERE source_id = $1 AND status = 'active'
       AND (last_collection_run_id IS NULL OR last_collection_run_id != $2)`,
    [sourceId, collectionRunId],
  );
  return rowCount ?? 0;
}
