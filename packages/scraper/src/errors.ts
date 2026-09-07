/**
 * Structured ingestion errors (Phase 5). Every failure the pipeline can produce is classified
 * into one of these categories so a caller (the worker job handler, tests) can decide how to
 * react without parsing error message strings. `ACCESS_DENIED` and `CAPTCHA` are the two
 * categories that must hard-stop the collection run — MASTER_PROMPT's compliance rule: no
 * bypass of any kind, ever, for either.
 */

export type IngestionErrorCategory =
  | "NAVIGATION_TIMEOUT"
  | "ACCESS_DENIED"
  | "CAPTCHA"
  | "SELECTOR_MISSING"
  | "PARSE_ERROR"
  | "NORMALIZATION_ERROR"
  | "PERSISTENCE_ERROR"
  | "BROWSER_ERROR"
  | "UNKNOWN_ERROR";

/** Categories that must stop the whole collection run rather than merely skipping one
 *  listing — access denial can never be worked around, per MASTER_PROMPT compliance rules. */
export const HARD_STOP_CATEGORIES: ReadonlySet<IngestionErrorCategory> = new Set([
  "ACCESS_DENIED",
  "CAPTCHA",
]);

export class IngestionError extends Error {
  readonly category: IngestionErrorCategory;
  readonly url: string | undefined;
  override readonly cause: unknown;

  constructor(
    category: IngestionErrorCategory,
    message: string,
    options?: { url?: string; cause?: unknown },
  ) {
    super(message);
    this.name = "IngestionError";
    this.category = category;
    this.url = options?.url;
    this.cause = options?.cause;
  }

  get isHardStop(): boolean {
    return HARD_STOP_CATEGORIES.has(this.category);
  }
}
