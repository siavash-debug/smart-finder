/**
 * The `SourceAdapter` contract (Phase 5). One adapter per listing source; all Divar-specific
 * knowledge (URLs, selectors, page structure) lives behind `DivarAdapter` and this interface is
 * the only thing the worker/browser-manager layer depends on. Adding a second source later
 * means writing a new adapter, not touching the pipeline that drives it.
 *
 * The four stages mirror MASTER_PROMPT's DISCOVER→FETCH→PARSE→NORMALIZE split:
 *  - `discover` finds candidate listing URLs/ids from an index page.
 *  - `fetch` loads one listing's detail page and pulls out raw (untrusted, unparsed) strings.
 *  - `parse` turns those raw strings into a source-shaped structured record — still untrusted
 *    text in each field, just organized.
 *  - `normalize` runs that structured record through `@smart-finder/normalizer` to produce the
 *    domain-shaped fields the database repository accepts. Never invents a value: a field that
 *    can't be confidently parsed comes out `null`/`undefined`, never a guess.
 */

import type { Page } from "playwright";

export interface DiscoveredListing {
  sourcePostingId: string;
  /** Canonical absolute URL for the listing's detail page. */
  url: string;
}

/**
 * A listing's detail page never reliably states its own transaction/property type as a single
 * parseable field (Divar's category is a breadcrumb, not a labeled attribute), so this comes
 * from *which category URL the caller configured the collector to crawl* — an explicit,
 * caller-supplied fact, not something inferred from page text. This is also where the "rent
 * must not become product scope" rule (MASTER_PROMPT) is enforced: the worker's job
 * configuration decides which `ListingContext` values it ever passes in, not this package.
 */
export interface ListingContext {
  transactionType: "sale" | "rent";
  propertyType: "apartment" | "house" | "land" | "other";
}

/** The database's `posting` row shape, minus identity/bookkeeping fields the worker (not the
 *  adapter) is responsible for attaching — `sourceId`, `contentHash`, `collectionRunId`. */
export interface NormalizedListingFields extends ListingContext {
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
  rawAddress?: string;
}

export interface SourceAdapter<RawPage, ParsedFields> {
  readonly sourceSlug: string;

  /** Navigates `page` to `discoverUrl` and returns the listings found there. Must never invent
   *  an id/url that wasn't actually present on the page. */
  discover(page: Page, discoverUrl: string): Promise<DiscoveredListing[]>;

  /** Navigates `page` to one listing's detail URL and extracts the raw, unparsed data the
   *  `parse` stage needs — DOM text/attributes, JSON-LD blocks, nothing beyond that. */
  fetch(page: Page, listing: DiscoveredListing): Promise<RawPage>;

  /** Pure, no I/O: turns `fetch`'s raw output into a structured (still source-shaped, still
   *  untrusted-text) record. */
  parse(raw: RawPage): ParsedFields;

  /** Pure, no I/O: runs `parse`'s output through the normalizer to produce domain fields.
   *  `context` supplies the transaction/property type the caller is crawling for (see
   *  `ListingContext`); `referenceDate` is injected (never `Date.now()` internally) so this
   *  stays deterministic and testable — needed for absolute-year-to-relative-age math. */
  normalize(
    parsed: ParsedFields,
    context: ListingContext,
    referenceDate: Date,
  ): NormalizedListingFields;
}
