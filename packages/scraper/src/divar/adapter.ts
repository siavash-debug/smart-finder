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

/** Runs entirely inside the page's own JS context (Playwright serializes this function to the
 *  browser) — cannot reference any outer-scope variable, only DOM APIs. */
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
  canonicalUrl: string | null;
  title: string | null;
  jsonLdDescription: string | null;
  infoRows: Record<string, string>;
  groupRow: { headers: string[]; values: string[] } | null;
  bodyText: string;
} {
  const title = document.querySelector(selectors.titleSelector)?.textContent?.trim() ?? null;

  let canonicalUrl: string | null = null;
  let jsonLdDescription: string | null = null;
  for (const script of document.querySelectorAll(selectors.jsonLdSelector)) {
    try {
      const data = JSON.parse(script.textContent ?? "null") as Record<string, unknown>;
      if (typeof data.url === "string" && data.url.includes("/v/")) canonicalUrl = data.url;
      if (typeof data.floorSize === "object" && typeof data.description === "string") {
        jsonLdDescription = data.description;
      }
    } catch {
      // Malformed JSON-LD is untrusted third-party content — skip this block, never throw.
    }
  }

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

  return { canonicalUrl, title, jsonLdDescription, infoRows, groupRow, bodyText };
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
    // earliest-rendering element, so it's the wait target; a genuinely missing title still
    // lets extraction proceed and come back mostly empty rather than erroring out.
    await page
      .waitForSelector(TITLE_SELECTOR, { timeout: this.navigationTimeoutMs })
      .catch(() => undefined);

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

    return { requestedUrl: listing.url, ...extracted };
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
