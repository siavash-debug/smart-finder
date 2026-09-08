/**
 * Playwright browser lifecycle (Phase 5). One `chromium` process per worker, reused across
 * every job — launching a fresh browser per listing would be far too slow and memory-hungry
 * for the free-tier deployment target. Navigation is wrapped so every failure mode Divar can
 * produce (timeout, 403, CAPTCHA, crash) comes out as a classified `IngestionError` instead of
 * a raw Playwright exception.
 *
 * Compliance (MASTER_PROMPT): there is no proxy rotation, stealth plugin, header spoofing, or
 * CAPTCHA-solving anywhere in this file, and none may be added. `ACCESS_DENIED`/`CAPTCHA` are
 * always a hard stop — see `CircuitBreaker` below.
 */

import { chromium, type Browser, type Page } from "playwright";

import { IngestionError } from "./errors.js";

export interface BrowserManagerOptions {
  /** Injectable so tests never launch a real browser. Defaults to a local `chromium.launch()`;
   *  pass `createCloudflareCdpLaunch(...)`'s result here to run against Cloudflare Browser
   *  Rendering instead — `BrowserManager` itself has no Cloudflare-specific knowledge. */
  launch?: () => Promise<Browser>;
  navigationTimeoutMs?: number;
}

const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;

/** Text/marker strings Divar's own CSP header names as its CAPTCHA provider (confirmed via a
 *  live `curl -I` against divar.ir during the Phase 5 access spike) — used only to *recognize*
 *  a CAPTCHA challenge and hard-stop, never to solve or bypass one. */
const CAPTCHA_MARKERS = ["arcaptcha", "captcha"];

/**
 * Builds a `BrowserManagerOptions.launch` function for a local Chromium — the same thing
 * `BrowserManager`'s own default does, exposed here only so callers that need to pass
 * `chromiumSandbox: false` don't have to duplicate the `chromium.launch({headless:true})` call.
 *
 * `chromiumSandbox: false` is a standard Playwright option (not a stealth/evasion technique —
 * it has no effect on how a scraped site perceives the browser) needed when Chromium runs as
 * root inside a container without the specific non-root user/permission setup Playwright's own
 * pre-built Docker image configures for its sandbox to work. Every existing call site (host
 * dev, CI, tests) keeps using `BrowserManager`'s own default (`chromiumSandbox` unset, i.e.
 * Playwright's normal sandboxed default) — this is opt-in, for the Docker collector only.
 */
export function createLocalChromiumLaunch(
  options: { chromiumSandbox?: boolean } = {},
): () => Promise<Browser> {
  return () =>
    chromium.launch({
      headless: true,
      ...(options.chromiumSandbox !== undefined
        ? { chromiumSandbox: options.chromiumSandbox }
        : {}),
    });
}

export interface CloudflareCdpConfig {
  accountId: string;
  apiToken: string;
  /** Milliseconds Cloudflare keeps the remote session alive with no activity before closing it
   *  (10_000-600_000; Cloudflare's own default is 60_000). Kept generous by default here since a
   *  collection run legitimately pauses between listings for parse/normalize/persist work that
   *  doesn't touch the browser. */
  keepAliveMs?: number;
}

const DEFAULT_CDP_KEEP_ALIVE_MS = 600_000;

/**
 * Builds a `BrowserManagerOptions.launch` function that connects to Cloudflare Browser
 * Rendering's real CDP endpoint over the network, instead of launching a local Chromium
 * process — the only Cloudflare-specific code in this package (ADR-0017: the
 * browser/runtime layer changes, `DivarAdapter` and everything above it does not).
 *
 * Uses Playwright's own `chromium.connectOverCDP`, not `@cloudflare/puppeteer` — that package's
 * `launch()`/`connect()` require a Cloudflare Workers `browser` binding (a `{fetch: typeof
 * fetch}` object only constructible inside an actual Workers execution context) and cannot run
 * in a plain Node.js process such as `apps/worker`. Cloudflare's CDP endpoint is a separate,
 * documented, network-reachable-from-anywhere interface authenticated by a bearer API token —
 * verified experimentally against the real Cloudflare account and the real Divar fixture URL
 * during this migration's Stage 2 (see docs/DECISIONS.md).
 */
export function createCloudflareCdpLaunch(config: CloudflareCdpConfig): () => Promise<Browser> {
  const keepAliveMs = config.keepAliveMs ?? DEFAULT_CDP_KEEP_ALIVE_MS;
  const endpoint =
    `wss://api.cloudflare.com/client/v4/accounts/${config.accountId}` +
    `/browser-rendering/devtools/browser?keep_alive=${keepAliveMs.toString()}`;

  return () =>
    chromium.connectOverCDP(endpoint, {
      headers: { Authorization: `Bearer ${config.apiToken}` },
    });
}

export class BrowserManager {
  private browserPromise: Promise<Browser> | null = null;
  private readonly launchFn: () => Promise<Browser>;
  readonly navigationTimeoutMs: number;

  constructor(options: BrowserManagerOptions = {}) {
    this.launchFn = options.launch ?? (() => chromium.launch({ headless: true }));
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
  }

  private async getBrowser(): Promise<Browser> {
    this.browserPromise ??= this.launchFn().catch((cause: unknown) => {
      this.browserPromise = null;
      throw new IngestionError("BROWSER_ERROR", "failed to launch browser", { cause });
    });
    return this.browserPromise;
  }

  /** Runs `fn` with a fresh page from the shared browser, always closing the page afterward —
   *  callers never manage page lifetime themselves. */
  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    if (this.browserPromise === null) return;
    const browser = await this.browserPromise.catch(() => null);
    this.browserPromise = null;
    if (browser !== null) await browser.close().catch(() => undefined);
  }
}

/**
 * Navigates `page` to `url`, classifying every failure mode into an `IngestionError`. A
 * non-2xx/3xx response status of 403 is `ACCESS_DENIED`; a page whose content mentions the
 * known CAPTCHA provider is `CAPTCHA`; a Playwright timeout is `NAVIGATION_TIMEOUT`; anything
 * else unexpected is `BROWSER_ERROR`. Never retries past a 403/CAPTCHA — that would be exactly
 * the kind of access-denial workaround compliance forbids.
 */
export async function navigateSafely(page: Page, url: string, timeoutMs: number): Promise<void> {
  let response;
  try {
    response = await page.goto(url, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.toLowerCase().includes("timeout")) {
      throw new IngestionError("NAVIGATION_TIMEOUT", `navigation to ${url} timed out`, {
        url,
        cause,
      });
    }
    throw new IngestionError("BROWSER_ERROR", `navigation to ${url} failed`, { url, cause });
  }

  if (response !== null && response.status() === 403) {
    throw new IngestionError("ACCESS_DENIED", `received 403 for ${url}`, { url });
  }

  const bodyText: string = await page
    .evaluate(() => document.body.innerText.toLowerCase())
    .catch(() => "");
  if (CAPTCHA_MARKERS.some((marker) => bodyText.includes(marker))) {
    throw new IngestionError("CAPTCHA", `CAPTCHA challenge detected on ${url}`, { url });
  }

  if (response === null) {
    throw new IngestionError("BROWSER_ERROR", `no response received for ${url}`, { url });
  }
}

/**
 * A hard-stop latch: once tripped by an `ACCESS_DENIED`/`CAPTCHA` error, every subsequent call
 * to `guard` throws immediately without touching the network again — MASTER_PROMPT's rule that
 * access denial ends the run, not just the one listing that hit it.
 */
export class CircuitBreaker {
  private trippedBy: IngestionError | null = null;

  guard(): void {
    if (this.trippedBy !== null) {
      throw new IngestionError(this.trippedBy.category, `circuit open: ${this.trippedBy.message}`, {
        ...(this.trippedBy.url !== undefined ? { url: this.trippedBy.url } : {}),
      });
    }
  }

  recordError(error: unknown): void {
    if (error instanceof IngestionError && error.isHardStop) {
      this.trippedBy ??= error;
    }
  }

  get isOpen(): boolean {
    return this.trippedBy !== null;
  }
}
