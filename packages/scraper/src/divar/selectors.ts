/**
 * Every Divar-specific selector/URL constant lives here, and only here — MASTER_PROMPT's
 * requirement that Divar's page structure knowledge stay centralized in one file rather than
 * scattered across the adapter. Sourced from a genuine, live Playwright access spike against
 * `https://divar.ir/s/tehran/rent-apartment` and `https://divar.ir/v/gaSebQzv` (ADR-0016),
 * not guessed or copied from documentation.
 */

export const DIVAR_BASE_URL = "https://divar.ir";

/** Listing cards on an index/search page are plain anchors to `/v/...` — this is the only
 *  reliable, stable way to enumerate listings; Divar has no `data-testid` on the card itself. */
export const LISTING_LINK_SELECTOR = 'a[href^="/v/"]';

/** JSON-LD blocks are the most reliable structured-data source on a detail page — Divar embeds
 *  several per page (breadcrumb, video, and the listing's own Product-shaped block). */
export const JSON_LD_SELECTOR = 'script[type="application/ld+json"]';

export const TITLE_SELECTOR = "h1.kt-page-title__title";

/**
 * Two independent label/value patterns cover every structured field this phase needs:
 *
 *  - `unexpandable-info-row`: a `data-testid`-marked row with a `.kt-base-row__title` label and
 *    a `.kt-unexpandable-row__value` value. Covers ودیعه (deposit/price) and طبقه (floor).
 *  - `kt-group-row` table: a `<thead>` of `.kt-group-row-item__title` labels paired
 *    positionally with a `<tbody>` row of `.kt-group-row-item__value`/`<td>` cells. Covers
 *    متراژ (area), ساخت (construction year), اتاق (rooms).
 *
 * Both were confirmed against the live spike's captured DOM (`spike2_output.json`), not
 * assumed from Divar's general design language.
 */
export const INFO_ROW_SELECTOR = '[data-testid="unexpandable-info-row"]';
export const INFO_ROW_TITLE_SELECTOR = ".kt-base-row__title";
export const INFO_ROW_VALUE_SELECTOR = ".kt-unexpandable-row__value";

export const GROUP_ROW_TABLE_SELECTOR = "table.kt-group-row";
export const GROUP_ROW_HEADER_CELL_SELECTOR = "thead .kt-group-row-item__title";
export const GROUP_ROW_VALUE_CELL_SELECTOR = "tbody td";

/**
 * The amenities section has no single stable container selector in the spike output beyond
 * being plain text within the page body, so amenities are read from the full body text and
 * handed to `parseAttribute`, which scans for the noun + negation pattern itself — this is
 * exactly the pattern `parseAttribute` already exists for, not a new one invented here.
 */
export const BODY_TEXT_SELECTOR = "body";
