/**
 * `DivarAdapter` — the only place besides `selectors.ts` that knows anything about Divar's page
 * structure. Implements `SourceAdapter` (discover/fetch/parse/normalize); the browser-lifecycle
 * concerns (navigation, timeouts, CAPTCHA/403 detection) belong to `browser.ts`, not here.
 */

import type { Page } from "playwright";

import { navigateSafely } from "../browser.js";
import type {
  DiscoveredListing,
  ListingContext,
  NormalizedListingFields,
  SourceAdapter,
} from "../types.js";
import { normalizeDivarFields } from "./normalize.js";
import { parseDivarDetailPage } from "./parse.js";
import {
  BODY_TEXT_SELECTOR,
  GROUP_ROW_HEADER_CELL_SELECTOR,
  GROUP_ROW_TABLE_SELECTOR,
  GROUP_ROW_VALUE_CELL_SELECTOR,
  INFO_ROW_SELECTOR,
  INFO_ROW_TITLE_SELECTOR,
  INFO_ROW_VALUE_SELECTOR,
  JSON_LD_SELECTOR,
  LISTING_LINK_SELECTOR,
  TITLE_SELECTOR,
} from "./selectors.js";
import type { ParsedDivarFields, RawDivarDetailPage } from "./types.js";
import { canonicalDetailUrl, extractSourcePostingId, toAbsoluteUrl } from "./url.js";
import { IngestionError } from "../errors.js";

export const DIVAR_SOURCE_SLUG = "divar";

/**
 * Divar sometimes wraps the Apartment/Product JSON-LD object (the one carrying `url`,
 * `floorSize`, and the free-text listing `description`) in a single-element array, sometimes
 * not — both real, confirmed shapes for the same kind of block on different listings (e.g.
 * `https://divar.ir/v/gaYq3kUB`, array-wrapped, vs the Phase 5 `gaSebQzv` fixture, a bare
 * object). Checking only the bare-object shape silently missed every array-wrapped listing's
 * `description` — and its `url`, from the same object — which is why `description` had been
 * unreachable since Phase 5, not a hydration timing issue (verified: the description is present
 * in the very first `domcontentloaded` DOM, inside a `<script type="application/ld+json">` tag
 * — JSON-LD is embedded server-rendered markup, not client-hydrated).
 *
 * Kept as a standalone, pure, exported function — not inlined into `extractRawDetailPage` below
 * — specifically so it's unit-testable without a browser: `extractRawDetailPage` runs inside
 * Playwright's `page.evaluate` (serialized to the browser, cannot reference any outer-scope
 * function), so this logic couldn't be called from there even if it were more convenient to
 * inline. It only ever sees the raw `<script>` tag text contents, which `extractRawDetailPage`
 * collects with a single cheap DOM read.
 */
export function parseJsonLdBlocks(rawJsonLdTexts: readonly string[]): {
  canonicalUrl: string | null;
  description: string | null;
} {
  let canonicalUrl: string | null = null;
  let description: string | null = null;

  for (const text of rawJsonLdTexts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue; // Malformed JSON-LD is untrusted third-party content — skip, never throw.
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      if (candidate === null || typeof candidate !== "object") continue;
      const data = candidate as Record<string, unknown>;
      if (typeof data.url === "string" && data.url.includes("/v/")) canonicalUrl = data.url;
      if (typeof data.floorSize === "object" && typeof data.description === "string") {
        description = data.description;
      }
    }
  }

  return { canonicalUrl, description };
}

/** Runs entirely inside the page's own JS context (Playwright serializes this function to the
 *  browser) — cannot reference any outer-scope variable, only DOM APIs. JSON-LD blocks are
 *  collected as raw text here (a plain DOM read) and parsed outside the browser by
 *  `parseJsonLdBlocks` — see that function's doc comment for why. */
function extractRawDetailPage(selectors: {
  titleSelector: string;
  jsonLdSelector: string;
  infoRowSelector: string;
  infoRowTitleSelector: string;
  infoRowValueSelector: string;
  groupRowTableSelector: string;
  groupRowHeaderCellSelector: string;
  groupRowValueCellSelector: string;
  bodyTextSelector: string;
}): {
  title: string | null;
  jsonLdTexts: string[];
  infoRows: Record<string, string>;
  groupRow: { headers: string[]; values: string[] } | null;
  bodyText: string;
} {
  const title = document.querySelector(selectors.titleSelector)?.textContent?.trim() ?? null;

  const jsonLdTexts = Array.from(document.querySelectorAll(selectors.jsonLdSelector)).map(
    (script) => script.textContent ?? "",
  );

  const infoRows: Record<string, string> = {};
  for (const row of document.querySelectorAll(selectors.infoRowSelector)) {
    const label = row.querySelector(selectors.infoRowTitleSelector)?.textContent?.trim();
    const value = row.querySelector(selectors.infoRowValueSelector)?.textContent?.trim();
    if (label !== undefined && label !== "" && value !== undefined && value !== "") {
      infoRows[label] = value;
    }
  }

  let groupRow: { headers: string[]; values: string[] } | null = null;
  const table = document.querySelector(selectors.groupRowTableSelector);
  if (table !== null) {
    const headers = Array.from(table.querySelectorAll(selectors.groupRowHeaderCellSelector)).map(
      (el: Element) => el.textContent?.trim() ?? "",
    );
    const values = Array.from(table.querySelectorAll(selectors.groupRowValueCellSelector)).map(
      (el: Element) => el.textContent?.trim() ?? "",
    );
    groupRow = { headers, values };
  }

  const bodyText = document.querySelector(selectors.bodyTextSelector)?.textContent ?? "";

  return { title, jsonLdTexts, infoRows, groupRow, bodyText };
}

export class DivarAdapter implements SourceAdapter<RawDivarDetailPage, ParsedDivarFields> {
  readonly sourceSlug = DIVAR_SOURCE_SLUG;

  constructor(private readonly navigationTimeoutMs: number) {}

  async discover(page: Page, discoverUrl: string): Promise<DiscoveredListing[]> {
    await navigateSafely(page, discoverUrl, this.navigationTimeoutMs);

    // The list page's cards render client-side after `domcontentloaded` fires (confirmed live
    // during the Phase 5 access spike), so `$$eval` right after navigation would race an empty
    // DOM. An empty result after this wait is a real "nothing found" (e.g. an empty search),
    // not a signal to retry or work around anything.
    await page
      .waitForSelector(LISTING_LINK_SELECTOR, { timeout: this.navigationTimeoutMs })
      .catch(() => undefined);

    const hrefs = await page.$$eval(LISTING_LINK_SELECTOR, (anchors) =>
      anchors.map((a) => a.getAttribute("href")).filter((href): href is string => href !== null),
    );

    const listings = new Map<string, DiscoveredListing>();
    for (const href of hrefs) {
      const absolute = toAbsoluteUrl(href);
      const sourcePostingId = extractSourcePostingId(absolute);
      if (sourcePostingId === null) continue;
      listings.set(sourcePostingId, { sourcePostingId, url: canonicalDetailUrl(sourcePostingId) });
    }
    return [...listings.values()];
  }

  async fetch(page: Page, listing: DiscoveredListing): Promise<RawDivarDetailPage> {
    await navigateSafely(page, listing.url, this.navigationTimeoutMs);

    // Same client-side-render timing as `discover` — the structured fields (group row table,
    // info rows) aren't in the DOM yet right after `domcontentloaded`. The title is the
    // earliest-rendering element, so it's waited for first; a genuinely missing title still
    // lets extraction proceed and come back mostly empty rather than erroring out.
    await page
      .waitForSelector(TITLE_SELECTOR, { timeout: this.navigationTimeoutMs })
      .catch(() => undefined);

    // A real Docker-collector run (documented in ADR-0019) showed area/rooms/building-age
    // (the group-row table) hydrating reliably while price/floor (the `unexpandable-info-row`
    // rows) intermittently had not yet — the title alone is not a sufficient readiness signal
    // for that second region. Waiting on the actual selector the price/floor extraction reads
    // from is a real, meaningful DOM condition, not a blind timeout.
    //
    // ADR-0021 investigated this further with repeated live measurements against real, fixed
    // listing URLs: the SAME listing, freshly navigated, resolved this exact selector in ~50ms
    // on one attempt and still hadn't after a full 20s (sometimes 45s+) on the next attempt —
    // proof this is genuine upstream response-time variance in Divar's own price/floor
    // data-loading, not a fixed hydration-order bug a smarter selector or a longer single wait
    // can reliably out-wait (a 58-second continuous wait was observed to still fail in one
    // trial). What the same investigation found DID help: a *fresh, independent* page load —
    // not a longer wait on the same one — succeeds where the original stalled, most likely
    // because Divar's backend/CDN makes an independent routing/caching decision per request. So
    // the fix here is a single bounded retry via reload, not a longer timeout: two independent,
    // shorter attempts, each on their own fresh network request, with the same combined worst
    // case as before — never an open-ended wait, and a listing with genuinely no info-rows
    // still proceeds (both attempts correctly find nothing and move on, no false success).
    const infoRowWaitMs = Math.round(this.navigationTimeoutMs / 2);
    const firstAttempt = await page
      .waitForSelector(INFO_ROW_SELECTOR, { timeout: infoRowWaitMs })
      .then(() => true)
      .catch(() => false);

    if (!firstAttempt) {
      await page
        .reload({ waitUntil: "domcontentloaded", timeout: infoRowWaitMs })
        .catch(() => undefined);
      await page
        .waitForSelector(INFO_ROW_SELECTOR, { timeout: infoRowWaitMs })
        .catch(() => undefined);
    }

    const extracted = await page.evaluate(extractRawDetailPage, {
      titleSelector: TITLE_SELECTOR,
      jsonLdSelector: JSON_LD_SELECTOR,
      infoRowSelector: INFO_ROW_SELECTOR,
      infoRowTitleSelector: INFO_ROW_TITLE_SELECTOR,
      infoRowValueSelector: INFO_ROW_VALUE_SELECTOR,
      groupRowTableSelector: GROUP_ROW_TABLE_SELECTOR,
      groupRowHeaderCellSelector: GROUP_ROW_HEADER_CELL_SELECTOR,
      groupRowValueCellSelector: GROUP_ROW_VALUE_CELL_SELECTOR,
      bodyTextSelector: BODY_TEXT_SELECTOR,
    });

    const { jsonLdTexts, ...rest } = extracted;
    const { canonicalUrl, description } = parseJsonLdBlocks(jsonLdTexts);

    return {
      requestedUrl: listing.url,
      ...rest,
      canonicalUrl,
      jsonLdDescription: description,
    };
  }

  parse(raw: RawDivarDetailPage): ParsedDivarFields {
    const parsed = parseDivarDetailPage(raw);
    if (parsed === null) {
      throw new IngestionError(
        "PARSE_ERROR",
        `could not determine posting id for ${raw.requestedUrl}`,
        {
          url: raw.requestedUrl,
        },
      );
    }
    return parsed;
  }

  normalize(
    parsed: ParsedDivarFields,
    context: ListingContext,
    referenceDate: Date,
  ): NormalizedListingFields {
    return normalizeDivarFields(parsed, context, referenceDate);
  }
}
