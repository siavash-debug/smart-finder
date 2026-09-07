/**
 * `source` repository (Phase 5). The table itself and its one seeded row (`divar`, migration
 * `0004_seed_divar_source.sql`) are Phase 5's only schema additions — everything else
 * ingestion needs (`posting`, `posting_version`, `collection_run`) was already fully modeled
 * in Phase 1's schema.
 */

import type { SourceRow } from "./domain.js";
import type { Queryable } from "./pool.js";

export async function getSourceBySlug(pool: Queryable, slug: string): Promise<SourceRow | null> {
  const { rows } = await pool.query<SourceRow>("SELECT * FROM source WHERE slug = $1", [slug]);
  return rows[0] ?? null;
}
