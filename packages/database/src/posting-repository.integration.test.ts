/**
 * Integration tests for source/collection_run/posting repositories against a real PostgreSQL
 * instance. Skips itself when no database is reachable — see `test-support/db.ts`.
 */

import { afterAll, describe, expect, it } from "vitest";

import type { CollectionRunRow } from "./domain.js";
import { getSourceBySlug } from "./source-repository.js";
import {
  completeCollectionRun,
  failCollectionRun,
  startCollectionRun,
} from "./collection-run-repository.js";
import {
  delistUntouchedPostings,
  getPostingBySourceId,
  getPostingVersions,
  upsertPosting,
  type UpsertPostingInput,
} from "./posting-repository.js";
import { closeTestPool, getTestPool, isTestDatabaseAvailable } from "./test-support/db.js";

const available = await isTestDatabaseAvailable();

function uniquePostingId(label: string): string {
  return `test-${label}-${Date.now().toString()}-${Math.random().toString(36).slice(2)}`;
}

function baseInput(
  sourceId: string,
  sourcePostingId: string,
  contentHash: string,
): UpsertPostingInput {
  return {
    sourceId,
    sourcePostingId,
    transactionType: "sale",
    propertyType: "apartment",
    title: "۱۱۰ متر دو خواب",
    priceToman: 4_100_000_000n,
    areaSqm: 110,
    rooms: 2,
    floor: 3,
    totalFloors: 5,
    contentHash,
  };
}

describe("source repository (integration)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it.runIf(available)("finds the seeded divar source", async () => {
    const source = await getSourceBySlug(getTestPool(), "divar");
    expect(source).not.toBeNull();
    expect(source?.slug).toBe("divar");
    expect(source?.base_url).toBe("https://divar.ir");
  });

  it.runIf(available)("returns null for an unknown slug", async () => {
    const source = await getSourceBySlug(getTestPool(), "unknown-source-xyz");
    expect(source).toBeNull();
  });
});

describe("collection_run repository (integration)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it.runIf(available)("starts a run in the running state", async () => {
    const pool = getTestPool();
    const source = await getSourceBySlug(pool, "divar");
    const run = await startCollectionRun(pool, source!.id);
    expect(run.status).toBe("running");
    expect(run.postings_seen).toBe(0);
  });

  it.runIf(available)("completes a run with counts", async () => {
    const pool = getTestPool();
    const source = await getSourceBySlug(pool, "divar");
    const run = await startCollectionRun(pool, source!.id);

    await completeCollectionRun(pool, run.id, {
      postingsSeen: 5,
      postingsNew: 2,
      postingsUpdated: 1,
    });

    const { rows } = await pool.query<CollectionRunRow>(
      "SELECT * FROM collection_run WHERE id = $1",
      [run.id],
    );
    expect(rows[0]).toMatchObject({
      status: "completed",
      postings_seen: 5,
      postings_new: 2,
      postings_updated: 1,
    });
    expect(rows[0]?.finished_at).not.toBeNull();
  });

  it.runIf(available)("fails a run with an error message", async () => {
    const pool = getTestPool();
    const source = await getSourceBySlug(pool, "divar");
    const run = await startCollectionRun(pool, source!.id);

    await failCollectionRun(pool, run.id, "ACCESS_DENIED: 403 on list page");

    const { rows } = await pool.query<CollectionRunRow>(
      "SELECT * FROM collection_run WHERE id = $1",
      [run.id],
    );
    expect(rows[0]).toMatchObject({
      status: "failed",
      error_message: "ACCESS_DENIED: 403 on list page",
    });
  });
});

describe("posting repository (integration)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it.runIf(available)(
    "a first-seen posting is created as new, with one posting_version",
    async () => {
      const pool = getTestPool();
      const source = await getSourceBySlug(pool, "divar");
      const sourcePostingId = uniquePostingId("new");

      const result = await upsertPosting(pool, baseInput(source!.id, sourcePostingId, "hash-v1"));

      expect(result.change).toBe("new");
      expect(result.posting.source_posting_id).toBe(sourcePostingId);
      expect(result.posting.status).toBe("active");

      const versions = await getPostingVersions(pool, result.posting.id);
      expect(versions).toHaveLength(1);
      expect(versions[0]?.content_hash).toBe("hash-v1");
    },
  );

  it.runIf(available)(
    "re-observing the same content is unchanged, with no new version",
    async () => {
      const pool = getTestPool();
      const source = await getSourceBySlug(pool, "divar");
      const sourcePostingId = uniquePostingId("unchanged");

      const first = await upsertPosting(pool, baseInput(source!.id, sourcePostingId, "hash-same"));
      const second = await upsertPosting(pool, baseInput(source!.id, sourcePostingId, "hash-same"));

      expect(second.change).toBe("unchanged");
      expect(second.posting.id).toBe(first.posting.id);

      const versions = await getPostingVersions(pool, first.posting.id);
      expect(versions).toHaveLength(1); // still just the original — no duplicate version
    },
  );

  it.runIf(available)(
    "the same source posting is never duplicated — repeated discovery upserts the same row",
    async () => {
      const pool = getTestPool();
      const source = await getSourceBySlug(pool, "divar");
      const sourcePostingId = uniquePostingId("no-dup");

      await upsertPosting(pool, baseInput(source!.id, sourcePostingId, "hash-a"));
      await upsertPosting(pool, baseInput(source!.id, sourcePostingId, "hash-a"));
      await upsertPosting(pool, baseInput(source!.id, sourcePostingId, "hash-a"));

      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM posting WHERE source_id = $1 AND source_posting_id = $2",
        [source!.id, sourcePostingId],
      );
      expect(rows[0]?.count).toBe("1");
    },
  );

  it.runIf(available)(
    "a changed price preserves the posting identity, updates fields, and appends a version",
    async () => {
      const pool = getTestPool();
      const source = await getSourceBySlug(pool, "divar");
      const sourcePostingId = uniquePostingId("changed");

      const first = await upsertPosting(
        pool,
        baseInput(source!.id, sourcePostingId, "hash-price-1"),
      );
      const second = await upsertPosting(pool, {
        ...baseInput(source!.id, sourcePostingId, "hash-price-2"),
        priceToman: 4_500_000_000n, // price increased
      });

      expect(second.change).toBe("changed");
      expect(second.posting.id).toBe(first.posting.id); // same identity, not a new posting
      expect(second.posting.price_toman).toBe(4_500_000_000n);

      const versions = await getPostingVersions(pool, first.posting.id);
      expect(versions).toHaveLength(2); // original preserved, new one appended
      expect(versions.map((v) => v.content_hash).sort()).toEqual(["hash-price-1", "hash-price-2"]);
    },
  );

  it.runIf(available)(
    "does not silently overwrite the earlier version's historical price",
    async () => {
      const pool = getTestPool();
      const source = await getSourceBySlug(pool, "divar");
      const sourcePostingId = uniquePostingId("price-history");

      const first = await upsertPosting(pool, {
        ...baseInput(source!.id, sourcePostingId, "hash-h1"),
        priceToman: 4_000_000_000n,
      });
      await upsertPosting(pool, {
        ...baseInput(source!.id, sourcePostingId, "hash-h2"),
        priceToman: 4_200_000_000n,
      });

      const versions = await getPostingVersions(pool, first.posting.id);
      const original = versions.find((v) => v.content_hash === "hash-h1");
      expect(original?.price_toman).toBe(4_000_000_000n); // untouched, still the original price
    },
  );

  it.runIf(available)("getPostingBySourceId finds the right row", async () => {
    const pool = getTestPool();
    const source = await getSourceBySlug(pool, "divar");
    const sourcePostingId = uniquePostingId("lookup");
    const created = await upsertPosting(
      pool,
      baseInput(source!.id, sourcePostingId, "hash-lookup"),
    );

    const found = await getPostingBySourceId(pool, source!.id, sourcePostingId);

    expect(found?.id).toBe(created.posting.id);
  });

  it.runIf(available)(
    "handles missing optional fields as null, never a guessed value",
    async () => {
      const pool = getTestPool();
      const source = await getSourceBySlug(pool, "divar");
      const sourcePostingId = uniquePostingId("sparse");

      const result = await upsertPosting(pool, {
        sourceId: source!.id,
        sourcePostingId,
        transactionType: "sale",
        propertyType: "apartment",
        contentHash: "hash-sparse",
        // Every optional field omitted.
      });

      expect(result.posting.price_toman).toBeNull();
      expect(result.posting.area_sqm).toBeNull();
      expect(result.posting.has_parking).toBeNull();
      expect(result.posting.has_elevator).toBeNull();
    },
  );

  describe("delistUntouchedPostings", () => {
    it.runIf(available)(
      "delists an active posting not touched by the given collection run",
      async () => {
        const pool = getTestPool();
        const source = await getSourceBySlug(pool, "divar");
        const staleId = uniquePostingId("stale");
        const freshId = uniquePostingId("fresh");

        const staleRun = await startCollectionRun(pool, source!.id);
        const stale = await upsertPosting(pool, {
          ...baseInput(source!.id, staleId, "hash-stale"),
          collectionRunId: staleRun.id,
        });
        await completeCollectionRun(pool, staleRun.id, {
          postingsSeen: 1,
          postingsNew: 1,
          postingsUpdated: 0,
        });

        const freshRun = await startCollectionRun(pool, source!.id);
        await upsertPosting(pool, {
          ...baseInput(source!.id, freshId, "hash-fresh"),
          collectionRunId: freshRun.id,
        });
        await completeCollectionRun(pool, freshRun.id, {
          postingsSeen: 1,
          postingsNew: 1,
          postingsUpdated: 0,
        });

        await delistUntouchedPostings(pool, source!.id, freshRun.id);

        const staleAfter = await getPostingBySourceId(pool, source!.id, staleId);
        const freshAfter = await getPostingBySourceId(pool, source!.id, freshId);
        expect(staleAfter?.status).toBe("delisted");
        expect(staleAfter?.delisted_at).not.toBeNull();
        expect(freshAfter?.status).toBe("active");
        expect(stale.posting.status).toBe("active"); // sanity: it really was active before
      },
    );
  });
});
