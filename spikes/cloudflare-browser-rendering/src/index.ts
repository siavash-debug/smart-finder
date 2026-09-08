/**
 * Cloudflare Browser Rendering spike — NOT production code, NOT part of packages/scraper.
 *
 * Purpose: prove or disprove whether Cloudflare's Browser Rendering (via the `@cloudflare/puppeteer`
 * binding) can open the exact same real Divar fixture URL the Phase 5 Playwright `DivarAdapter`
 * smoke test uses (`https://divar.ir/v/gaSebQzv`, see
 * packages/scraper/src/divar/adapter.smoke.test.ts) and extract the same core fields, using the
 * same selectors (copied verbatim from packages/scraper/src/divar/selectors.ts below — copied,
 * not imported, to keep this spike fully isolated from the production package as instructed).
 *
 * GET /            -> runs the real extraction against the Phase 5 fixture URL.
 * GET /?fail=1      -> controlled failure test: navigates to a URL with no `/v/{id}` posting,
 *                      to observe how selector-missing / no-content failures are classified.
 * GET /?url=<other> -> optional override for manual exploration (still same extraction logic).
 */

import puppeteer, { type BrowserWorker } from "@cloudflare/puppeteer";

export interface Env {
  BROWSER: BrowserWorker;
}

// ---- Copied verbatim from packages/scraper/src/divar/selectors.ts (Phase 5, unmodified) ----
const TITLE_SELECTOR = "h1.kt-page-title__title";
const JSON_LD_SELECTOR = 'script[type="application/ld+json"]';
const INFO_ROW_SELECTOR = '[data-testid="unexpandable-info-row"]';
const INFO_ROW_TITLE_SELECTOR = ".kt-base-row__title";
const INFO_ROW_VALUE_SELECTOR = ".kt-unexpandable-row__value";
const GROUP_ROW_TABLE_SELECTOR = "table.kt-group-row";
const GROUP_ROW_HEADER_CELL_SELECTOR = "thead .kt-group-row-item__title";
const GROUP_ROW_VALUE_CELL_SELECTOR = "tbody td";
const BODY_TEXT_SELECTOR = "body";
// Copied verbatim from packages/scraper/src/browser.ts's CAPTCHA_MARKERS.
const CAPTCHA_MARKERS = ["arcaptcha", "captcha"];

const DEFAULT_FIXTURE_URL = "https://divar.ir/v/gaSebQzv";
// A URL with no /v/{id} posting — used only for the controlled failure test (§8 of the spike
// brief). Never an attempt to bypass or attack anything; just a page with no listing DOM to find.
const CONTROLLED_FAILURE_URL = "https://divar.ir/does-not-exist-smart-finder-spike";

interface ExtractedRaw {
  title: string | null;
  canonicalUrl: string | null;
  infoRows: Record<string, string>;
  groupRow: { headers: string[]; values: string[] } | null;
  bodyTextSample: string;
}

/** Runs inside the remote browser's page context via page.evaluate — same shape as
 *  packages/scraper/src/divar/adapter.ts's extractRawDetailPage, copied not imported. */
function extractInPage(selectors: {
  titleSelector: string;
  jsonLdSelector: string;
  infoRowSelector: string;
  infoRowTitleSelector: string;
  infoRowValueSelector: string;
  groupRowTableSelector: string;
  groupRowHeaderCellSelector: string;
  groupRowValueCellSelector: string;
  bodyTextSelector: string;
}): ExtractedRaw {
  const title = document.querySelector(selectors.titleSelector)?.textContent?.trim() ?? null;

  let canonicalUrl: string | null = null;
  for (const script of document.querySelectorAll(selectors.jsonLdSelector)) {
    try {
      const data = JSON.parse(script.textContent ?? "null") as Record<string, unknown>;
      if (typeof data.url === "string" && data.url.includes("/v/")) canonicalUrl = data.url;
    } catch {
      // Malformed JSON-LD is untrusted third-party content — skip, never throw.
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
      (el) => el.textContent?.trim() ?? "",
    );
    const values = Array.from(table.querySelectorAll(selectors.groupRowValueCellSelector)).map(
      (el) => el.textContent?.trim() ?? "",
    );
    groupRow = { headers, values };
  }

  const bodyText = document.querySelector(selectors.bodyTextSelector)?.textContent ?? "";

  return { title, canonicalUrl, infoRows, groupRow, bodyTextSample: bodyText.slice(0, 300) };
}

type ErrorCategory =
  | "NAVIGATION_TIMEOUT"
  | "ACCESS_DENIED"
  | "CAPTCHA"
  | "SELECTOR_MISSING"
  | "BROWSER_ERROR"
  | "UNKNOWN_ERROR";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const invocationStart = Date.now();
    const requestUrl = new URL(request.url);
    const controlledFailure = requestUrl.searchParams.get("fail") === "1";
    const targetUrl =
      requestUrl.searchParams.get("url") ??
      (controlledFailure ? CONTROLLED_FAILURE_URL : DEFAULT_FIXTURE_URL);

    const diagnostics: Record<string, unknown> = {
      targetUrl,
      controlledFailureTest: controlledFailure,
      browserLaunchSuccess: false,
      navigationSuccess: false,
      finalUrl: null as string | null,
      navigationStatus: null as number | null,
      pageTitle: null as string | null,
      selectorsFound: {
        title: false,
        infoRow: false,
        groupRowTable: false,
      },
      accessDeniedOrCaptchaDetected: false,
      errorCategory: null as ErrorCategory | null,
      errorMessage: null as string | null,
      timingMs: {
        browserLaunch: null as number | null,
        navigation: null as number | null,
        extraction: null as number | null,
        total: null as number | null,
      },
    };

    let browser;
    try {
      const launchStart = Date.now();
      browser = await puppeteer.launch(env.BROWSER);
      diagnostics.browserLaunchSuccess = true;
      diagnostics["timingMs"] = {
        ...(diagnostics["timingMs"] as object),
        browserLaunch: Date.now() - launchStart,
      };
    } catch (cause) {
      diagnostics.errorCategory = "BROWSER_ERROR" satisfies ErrorCategory;
      diagnostics.errorMessage = cause instanceof Error ? cause.message : String(cause);
      diagnostics["timingMs"] = {
        ...(diagnostics["timingMs"] as object),
        total: Date.now() - invocationStart,
      };
      return Response.json({ diagnostics, extracted: null, fields: null }, { status: 502 });
    }

    let extracted: ExtractedRaw | null = null;
    try {
      const page = await browser.newPage();

      const navStart = Date.now();
      let response;
      try {
        response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        diagnostics.errorCategory = message.toLowerCase().includes("timeout")
          ? ("NAVIGATION_TIMEOUT" satisfies ErrorCategory)
          : ("BROWSER_ERROR" satisfies ErrorCategory);
        diagnostics.errorMessage = message;
        throw cause;
      }
      diagnostics["timingMs"] = {
        ...(diagnostics["timingMs"] as object),
        navigation: Date.now() - navStart,
      };
      diagnostics.navigationSuccess = true;
      diagnostics.navigationStatus = response?.status() ?? null;
      diagnostics.finalUrl = page.url();

      if (response !== null && response.status() === 403) {
        diagnostics.accessDeniedOrCaptchaDetected = true;
        diagnostics.errorCategory = "ACCESS_DENIED" satisfies ErrorCategory;
        diagnostics.errorMessage = `received 403 for ${targetUrl}`;
      }

      // Same client-side-render wait Phase 5's DivarAdapter.fetch uses: wait for the title,
      // don't hard-fail if it never shows up (matches production behavior exactly).
      await page.waitForSelector(TITLE_SELECTOR, { timeout: 30_000 }).catch(() => undefined);

      diagnostics.pageTitle = await page.title();

      const extractStart = Date.now();
      extracted = await page.evaluate(extractInPage, {
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
      diagnostics["timingMs"] = {
        ...(diagnostics["timingMs"] as object),
        extraction: Date.now() - extractStart,
      };

      diagnostics.selectorsFound = {
        title: extracted.title !== null,
        infoRow: Object.keys(extracted.infoRows).length > 0,
        groupRowTable: extracted.groupRow !== null,
      };

      const bodyLower = extracted.bodyTextSample.toLowerCase();
      if (CAPTCHA_MARKERS.some((marker) => bodyLower.includes(marker))) {
        diagnostics.accessDeniedOrCaptchaDetected = true;
        diagnostics.errorCategory = "CAPTCHA" satisfies ErrorCategory;
        diagnostics.errorMessage = `CAPTCHA marker found on ${targetUrl}`;
      }

      if (
        extracted.title === null &&
        Object.keys(extracted.infoRows).length === 0 &&
        extracted.groupRow === null
      ) {
        diagnostics.errorCategory = "SELECTOR_MISSING" satisfies ErrorCategory;
        diagnostics.errorMessage = "no expected selectors matched anything on the page";
      }
    } catch (cause) {
      if (diagnostics.errorCategory === null) {
        diagnostics.errorCategory = "UNKNOWN_ERROR" satisfies ErrorCategory;
        diagnostics.errorMessage = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      // Mirrors packages/scraper/src/browser.ts's BrowserManager: always release, never leak.
      await browser.close().catch(() => undefined);
    }

    diagnostics["timingMs"] = {
      ...(diagnostics["timingMs"] as object),
      total: Date.now() - invocationStart,
    };

    // Map the raw extraction onto the same six core fields the spike brief asks for. This is
    // intentionally NOT the full parse/normalize pipeline (packages/scraper/src/divar/parse.ts,
    // normalize.ts) — those are unmodified and untouched; this spike proves the browser/DOM
    // layer only, per the brief's explicit scope.
    const fields = extracted
      ? {
          title: extracted.title,
          // "ودیعه" (deposit/price) comes from the info-row label/value pattern.
          price: extracted.infoRows["ودیعه"] ?? null,
          // متراژ (area) / اتاق (rooms) come from the group-row table, paired positionally by
          // header index — same approach parse.ts uses on the real (unmodified) parsed data.
          area: extractGroupRowValue(extracted.groupRow, "متراژ"),
          rooms: extractGroupRowValue(extracted.groupRow, "اتاق"),
          floor: extracted.infoRows["طبقه"] ?? null,
          sourceUrl: extracted.canonicalUrl ?? diagnostics.finalUrl,
        }
      : null;

    return Response.json({ diagnostics, extracted, fields });
  },
} satisfies ExportedHandler<Env>;

function extractGroupRowValue(
  groupRow: { headers: string[]; values: string[] } | null,
  headerLabel: string,
): string | null {
  if (groupRow === null) return null;
  const index = groupRow.headers.indexOf(headerLabel);
  if (index === -1) return null;
  return groupRow.values[index] ?? null;
}
