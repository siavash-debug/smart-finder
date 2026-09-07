/**
 * Ingestion (source-access) package (Phase 5). Playwright is isolated entirely to this package
 * — normalizer/matching/database/telegram/web never import it and never touch Divar directly
 * (ADR-0016).
 */

export {
  BrowserManager,
  CircuitBreaker,
  navigateSafely,
  type BrowserManagerOptions,
} from "./browser.js";
export { computeContentHash } from "./content-hash.js";
export { HARD_STOP_CATEGORIES, IngestionError, type IngestionErrorCategory } from "./errors.js";
export type {
  DiscoveredListing,
  ListingContext,
  NormalizedListingFields,
  SourceAdapter,
} from "./types.js";

export { DIVAR_SOURCE_SLUG, DivarAdapter } from "./divar/adapter.js";
export { normalizeDivarFields } from "./divar/normalize.js";
export { parseDivarDetailPage } from "./divar/parse.js";
export { DIVAR_BASE_URL } from "./divar/selectors.js";
export type { ParsedDivarFields, RawDivarDetailPage } from "./divar/types.js";
export { canonicalDetailUrl, extractSourcePostingId, toAbsoluteUrl } from "./divar/url.js";
