/**
 * Integration tests for the `collect_divar` job handler against a real PostgreSQL instance.
 * Playwright itself is faked out (a stub `BrowserManager`/adapter) — the point of these tests
 * is the DISCOVER→...→PERSIST *orchestration and persistence*, not real browser automation
 * (that's covered by the Phase 5 live access spike and `@smart-finder/scraper`'s own unit
 * tests against real spike-derived fixtures). Skips itself when no database is reachable.
 */

import { afterAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";

import {
  getPostingBySourceId,
  getSourceBySlug,
  type CollectionRunRow,
} from "@smart-finder/database";
import { createLogger, type LogRecord } from "@smart-finder/shared";
import {
  IngestionError,
  type BrowserManager,
  type DiscoveredListing,
  type ListingContext,
  type NormalizedListingFields,
} from "@smart-finder/scraper";

import {
  closeTestPool,
  getTestPool,
  isTestDatabaseAvailable,
} from "../../../packages/database/src/test-support/db.js";
import { createCollectDivarHandler, COLLECT_DIVAR_JOB_TYPE } from "./divar-collection-handler.js";
import type { JobHandlerContext } from "./job-dispatcher.js";

const available = await isTestDatabaseAvailable();

function uniqueId(label: string): string {
  return `test-${label}-${Date.now().toString()}-${Math.random().toString(36).slice(2)}`;
}

function silentContext(records: LogRecord[] = []): JobHandlerContext {
  return {
    logger: createLogger({ level: "trace", sink: (r) => records.push(r) }),
    runId: "test-run",
  };
}

/** A stub `BrowserManager` that never launches a real browser — `withPage` just invokes the
 *  callback with an unused placeholder `Page`, since the fake adapter below never touches it. */
function fakeBrowserManager(): BrowserManager {
  return {
    withPage: <T>(fn: (page: Page) => Promise<T>): Promise<T> => fn({} as Page),
    close: () => Promise.resolve(undefined),
  } as unknown as BrowserManager;
}

interface FakeListingBehavior {
  listing: DiscoveredListing;
  result: { kind: "ok"; fields: NormalizedListingFields } | { kind: "error"; error: unknown };
}

/** A fake adapter driven entirely by a fixed script — `discover` returns exactly the listings
 *  given, and `fetch`/`parse`/`normalize` for each one either succeeds with the given fields or
 *  throws the given error, so each test controls the pipeline's behavior precisely without a
 *  real page. */
function fakeAdapter(behaviors: FakeListingBehavior[]) {
  return {
    sourceSlug: "divar",
    discover: () => Promise.resolve(behaviors.map((b) => b.listing)),
    fetch: async (_page: Page, listing: DiscoveredListing) => {
      await Promise.resolve(); // keeps this a genuine async boundary, matching the real adapter
      const behavior = behaviors.find(
        (b) => b.listing.sourcePostingId === listing.sourcePostingId,
      )!;
      if (behavior.result.kind === "error") throw behavior.result.error;
      return { listing };
    },
    parse: (raw: { listing: DiscoveredListing }) => raw,
    normalize: (raw: { listing: DiscoveredListing }) => {
      const behavior = behaviors.find(
        (b) => b.listing.sourcePostingId === raw.listing.sourcePostingId,
      )!;
      if (behavior.result.kind === "error") throw behavior.result.error;
      return behavior.result.fields;
    },
  };
}

const CONTEXT: ListingContext = { transactionType: "sale", propertyType: "apartment" };

function fields(overrides: Partial<NormalizedListingFields> = {}): NormalizedListingFields {
  return { ...CONTEXT, title: "تست", priceToman: 1_000_000_000n, areaSqm: 80, ...overrides };
}

describe("collect_divar handler (integration)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it.runIf(available)("persists newly discovered listings and completes the run", async () => {
    const pool = getTestPool();
    const source = await getSourceBySlug(pool, "divar");
    const idA = uniqueId("a");
    const idB = uniqueId("b");

    const handler = createCollectDivarHandler({
      pool,
      browserManager: fakeBrowserManager(),
      adapter: fakeAdapter([
        {
          listing: { sourcePostingId: idA, url: `https://divar.ir/v/${idA}` },
          result: { kind: "ok", fields: fields() },
        },
        {
          listing: { sourcePostingId: idB, url: `https://divar.ir/v/${idB}` },
          result: { kind: "ok", fields: fields({ areaSqm: 95 }) },
        },
      ]) as never,
    });

    await handler(
      { discoverUrl: "https://divar.ir/s/tehran/buy-apartment", ...CONTEXT },
      silentContext(),
    );

    const postingA = await getPostingBySourceId(pool, source!.id, idA);
    const postingB = await getPostingBySourceId(pool, source!.id, idB);
    expect(postingA?.status).toBe("active");
    expect(postingB?.area_sqm).toBe(95);

    const { rows } = await pool.query<CollectionRunRow>(
      "SELECT * FROM collection_run WHERE source_id = $1 ORDER BY started_at DESC LIMIT 1",
      [source!.id],
    );
    expect(rows[0]).toMatchObject({ status: "completed", postings_seen: 2, postings_new: 2 });
  });

  it.runIf(available)("re-running with unchanged content reports unchanged, not new", async () => {
    const pool = getTestPool();
    const id = uniqueId("unchanged");
    const listing = { sourcePostingId: id, url: `https://divar.ir/v/${id}` };
    const makeHandler = () =>
      createCollectDivarHandler({
        pool,
        browserManager: fakeBrowserManager(),
        adapter: fakeAdapter([{ listing, result: { kind: "ok", fields: fields() } }]) as never,
      });

    const payload = { discoverUrl: "https://divar.ir/s/tehran/buy-apartment", ...CONTEXT };
    await makeHandler()(payload, silentContext());
    await makeHandler()(payload, silentContext());

    const source = await getSourceBySlug(pool, "divar");
    const { rows } = await pool.query<CollectionRunRow>(
      "SELECT * FROM collection_run WHERE source_id = $1 ORDER BY started_at DESC LIMIT 1",
      [source!.id],
    );
    expect(rows[0]).toMatchObject({ status: "completed", postings_seen: 1, postings_new: 0 });
  });

  it.runIf(available)(
    "skips one listing that fails with a non-hard-stop error, keeps the run going",
    async () => {
      const pool = getTestPool();
      const source = await getSourceBySlug(pool, "divar");
      const okId = uniqueId("ok");
      const badId = uniqueId("bad");

      const handler = createCollectDivarHandler({
        pool,
        browserManager: fakeBrowserManager(),
        adapter: fakeAdapter([
          {
            listing: { sourcePostingId: okId, url: `https://divar.ir/v/${okId}` },
            result: { kind: "ok", fields: fields() },
          },
          {
            listing: { sourcePostingId: badId, url: `https://divar.ir/v/${badId}` },
            result: { kind: "error", error: new IngestionError("PARSE_ERROR", "malformed page") },
          },
        ]) as never,
      });

      await handler(
        { discoverUrl: "https://divar.ir/s/tehran/buy-apartment", ...CONTEXT },
        silentContext(),
      );

      const okPosting = await getPostingBySourceId(pool, source!.id, okId);
      const badPosting = await getPostingBySourceId(pool, source!.id, badId);
      expect(okPosting?.status).toBe("active");
      expect(badPosting).toBeNull();

      const { rows } = await pool.query<CollectionRunRow>(
        "SELECT * FROM collection_run WHERE source_id = $1 ORDER BY started_at DESC LIMIT 1",
        [source!.id],
      );
      expect(rows[0]).toMatchObject({ status: "completed", postings_seen: 1, postings_new: 1 });
    },
  );

  it.runIf(available)(
    "a hard-stop error (ACCESS_DENIED) aborts the whole run and marks it failed, not partially completed",
    async () => {
      const pool = getTestPool();
      const source = await getSourceBySlug(pool, "divar");
      const id = uniqueId("denied");

      const handler = createCollectDivarHandler({
        pool,
        browserManager: fakeBrowserManager(),
        adapter: fakeAdapter([
          {
            listing: { sourcePostingId: id, url: `https://divar.ir/v/${id}` },
            result: { kind: "error", error: new IngestionError("ACCESS_DENIED", "403") },
          },
        ]) as never,
      });

      await expect(
        handler(
          { discoverUrl: "https://divar.ir/s/tehran/buy-apartment", ...CONTEXT },
          silentContext(),
        ),
      ).rejects.toMatchObject({ category: "ACCESS_DENIED" });

      const posting = await getPostingBySourceId(pool, source!.id, id);
      expect(posting).toBeNull();

      const { rows } = await pool.query<CollectionRunRow>(
        "SELECT * FROM collection_run WHERE source_id = $1 ORDER BY started_at DESC LIMIT 1",
        [source!.id],
      );
      expect(rows[0]).toMatchObject({ status: "failed" });
      expect(rows[0]?.error_message).toContain("403");
    },
  );

  it.runIf(available)(
    "rejects a job payload asking for a transaction/property type outside today's scope",
    async () => {
      const pool = getTestPool();
      const handler = createCollectDivarHandler({
        pool,
        browserManager: fakeBrowserManager(),
        adapter: fakeAdapter([]) as never,
      });

      await expect(
        handler(
          {
            discoverUrl: "https://divar.ir/s/tehran/rent-apartment",
            transactionType: "rent",
            propertyType: "apartment",
          },
          silentContext(),
        ),
      ).rejects.toThrow(/scope/);
    },
  );

  it("exports the job type constant used for handler registration", () => {
    expect(COLLECT_DIVAR_JOB_TYPE).toBe("collect_divar");
  });
});
