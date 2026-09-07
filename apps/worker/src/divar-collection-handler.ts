/**
 * The `collect_divar` job handler — orchestrates DISCOVER→FETCH→PARSE→NORMALIZE→PERSIST for one
 * Divar category URL (Phase 5). Owns orchestration and database bookkeeping only; every
 * Divar-specific and Playwright-specific concern lives in `@smart-finder/scraper`
 * (`DivarAdapter`, `BrowserManager`) — this file never touches a selector or a page directly.
 *
 * A single listing's `IngestionError` is caught and skipped (one bad listing must not sink an
 * entire collection run), except a hard-stop category (`ACCESS_DENIED`/`CAPTCHA`), which aborts
 * the whole run immediately per MASTER_PROMPT's compliance rule — no workaround, no partial
 * continuation once access has genuinely been denied.
 *
 * `delistUntouchedPostings` (`@smart-finder/database`) is deliberately never called here: Phase
 * 5's collection runs are small/bounded (a handful of listings from one category URL, per the
 * access-spike-only scope), so a run never covers a source's full active catalog — calling it
 * would incorrectly delist every previously-known posting this run didn't happen to revisit.
 * See that function's own doc comment.
 */

import {
  completeCollectionRun,
  failCollectionRun,
  getSourceBySlug,
  startCollectionRun,
  upsertPosting,
  type DatabasePool,
} from "@smart-finder/database";
import {
  computeContentHash,
  DIVAR_SOURCE_SLUG,
  IngestionError,
  type BrowserManager,
  type DivarAdapter,
  type ListingContext,
} from "@smart-finder/scraper";

import type { JobHandler, JobHandlerContext } from "./job-dispatcher.js";

export const COLLECT_DIVAR_JOB_TYPE = "collect_divar";

export interface CollectDivarDeps {
  pool: DatabasePool;
  browserManager: BrowserManager;
  adapter: DivarAdapter;
  /** Injectable so the absolute-year-to-relative-age normalization step stays deterministic
   *  and testable — never a hidden `Date.now()` read. */
  now?: () => Date;
}

/**
 * The `posting` table's `transaction_type`/`property_type` columns are currently locked to
 * `"sale"`/`"apartment"` (migration `0002_core_schema.sql`, `domain.ts`'s `TransactionType`/
 * `PropertyType`) — Phase 1's own scope, and MASTER_PROMPT's explicit Phase 5 instruction that
 * the rent listing URL is for learning page *structure* only and must never become product
 * scope. `DivarAdapter`/`ListingContext` stay source-generic (a rent/land/etc. category is a
 * real, valid Divar page shape a future phase could legitimately crawl), but this handler is
 * the boundary that enforces today's actual scope: it rejects any job payload asking for
 * something the schema can't even store, rather than silently coercing or widening the schema.
 */
function isSupportedListingContext(
  value: unknown,
): value is { transactionType: "sale"; propertyType: "apartment" } {
  if (typeof value !== "object" || value === null) return false;
  const { transactionType, propertyType } = value as Record<string, unknown>;
  return transactionType === "sale" && propertyType === "apartment";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCategory(error: unknown): string {
  return error instanceof IngestionError ? error.category : "UNKNOWN_ERROR";
}

export function createCollectDivarHandler(deps: CollectDivarDeps): JobHandler {
  const now = deps.now ?? (() => new Date());

  return async (payload: Record<string, unknown>, context: JobHandlerContext): Promise<void> => {
    const discoverUrl = payload.discoverUrl;
    if (typeof discoverUrl !== "string" || discoverUrl === "") {
      throw new Error('job payload missing a non-empty string "discoverUrl"');
    }
    if (!isSupportedListingContext(payload)) {
      throw new Error(
        'job payload must have "transactionType": "sale" and "propertyType": "apartment" — ' +
          "the only transaction/property type the schema currently stores (rent is structure-only, not in scope)",
      );
    }
    const listingContext: ListingContext = {
      transactionType: payload.transactionType,
      propertyType: payload.propertyType,
    };

    const source = await getSourceBySlug(deps.pool, DIVAR_SOURCE_SLUG);
    if (source === null) {
      throw new Error(`no "${DIVAR_SOURCE_SLUG}" row in source — run the seed migration first`);
    }

    const run = await startCollectionRun(deps.pool, source.id);
    let postingsSeen = 0;
    let postingsNew = 0;
    let postingsUpdated = 0;

    try {
      await deps.browserManager.withPage(async (page) => {
        const listings = await deps.adapter.discover(page, discoverUrl);
        context.logger.info("divar_discover_completed", {
          status: "discovered",
          count: listings.length,
        });

        for (const listing of listings) {
          try {
            const raw = await deps.adapter.fetch(page, listing);
            const parsed = deps.adapter.parse(raw);
            const normalized = deps.adapter.normalize(parsed, listingContext, now());
            const contentHash = computeContentHash(normalized);

            const result = await upsertPosting(deps.pool, {
              sourceId: source.id,
              sourcePostingId: listing.sourcePostingId,
              contentHash,
              collectionRunId: run.id,
              ...normalized,
              // `listingContext` is validated above to be exactly this pair — restated as
              // literals here only to satisfy `UpsertPostingInput`'s narrower (schema-matching)
              // type, not a different value than what `normalize` was actually given.
              transactionType: "sale",
              propertyType: "apartment",
            });

            postingsSeen += 1;
            if (result.change === "new") postingsNew += 1;
            else if (result.change === "changed") postingsUpdated += 1;
          } catch (error) {
            if (error instanceof IngestionError && error.isHardStop) throw error;

            context.logger.warn("divar_listing_ingestion_failed", {
              err: error,
              error_type: errorCategory(error),
              source_posting_id: listing.sourcePostingId,
            });
          }
        }
      });

      await completeCollectionRun(deps.pool, run.id, {
        postingsSeen,
        postingsNew,
        postingsUpdated,
      });
      context.logger.info("divar_collection_run_completed", {
        status: "completed",
        postings_seen: postingsSeen,
        postings_new: postingsNew,
        postings_updated: postingsUpdated,
      });
    } catch (error) {
      await failCollectionRun(deps.pool, run.id, errorMessage(error));
      context.logger.error("divar_collection_run_failed", {
        err: error,
        error_type: errorCategory(error),
        status: "failed",
      });
      throw error;
    }
  };
}
