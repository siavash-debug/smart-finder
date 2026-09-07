/**
 * `collection_run` repository (Phase 5). One row per collector execution. Delisting a
 * posting is only ever trusted after a `completed` (healthy) run — never inferred from a
 * single missing observation (MASTER_PROMPT §22, already documented in migration
 * `0002_core_schema.sql`'s own comment on this table).
 */

import type { CollectionRunRow } from "./domain.js";
import type { Queryable } from "./pool.js";

export async function startCollectionRun(
  pool: Queryable,
  sourceId: string,
): Promise<CollectionRunRow> {
  const { rows } = await pool.query<CollectionRunRow>(
    "INSERT INTO collection_run (source_id) VALUES ($1) RETURNING *",
    [sourceId],
  );
  return rows[0]!;
}

export interface CollectionRunCounts {
  postingsSeen: number;
  postingsNew: number;
  postingsUpdated: number;
}

export async function completeCollectionRun(
  pool: Queryable,
  id: string,
  counts: CollectionRunCounts,
): Promise<void> {
  await pool.query(
    `UPDATE collection_run
     SET status = 'completed', finished_at = now(),
         postings_seen = $2, postings_new = $3, postings_updated = $4
     WHERE id = $1`,
    [id, counts.postingsSeen, counts.postingsNew, counts.postingsUpdated],
  );
}

/** A failed run's postings are never trusted for delisting — MASTER_PROMPT §22 — so no counts
 *  are recorded here beyond what was already true when the failure happened. */
export async function failCollectionRun(
  pool: Queryable,
  id: string,
  errorMessage: string,
): Promise<void> {
  await pool.query(
    "UPDATE collection_run SET status = 'failed', finished_at = now(), error_message = $2 WHERE id = $1",
    [id, errorMessage],
  );
}

export async function getCollectionRunById(
  pool: Queryable,
  id: string,
): Promise<CollectionRunRow | null> {
  const { rows } = await pool.query<CollectionRunRow>(
    "SELECT * FROM collection_run WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}
