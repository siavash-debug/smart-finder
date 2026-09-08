import { describe, expect, it, vi } from "vitest";
import type * as Playwright from "playwright";
import type { Browser, Page } from "playwright";

vi.mock("playwright", async () => {
  const actual = await vi.importActual<typeof Playwright>("playwright");
  return {
    ...actual,
    chromium: { ...actual.chromium, connectOverCDP: vi.fn(), launch: vi.fn() },
  };
});

import { chromium } from "playwright";

import {
  BrowserManager,
  CircuitBreaker,
  createCloudflareCdpLaunch,
  createLocalChromiumLaunch,
  navigateSafely,
} from "./browser.js";
import { IngestionError } from "./errors.js";

function fakePage(overrides: Partial<Page> = {}): Page {
  return {
    goto: vi.fn().mockResolvedValue({ status: () => 200 }),
    evaluate: vi.fn().mockResolvedValue(""),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Page;
}

describe("navigateSafely — access/error classification", () => {
  it("succeeds on a normal 200 response with no CAPTCHA markers", async () => {
    const page = fakePage();
    await expect(navigateSafely(page, "https://divar.ir/v/x", 5000)).resolves.toBeUndefined();
  });

  it("classifies a 403 response as ACCESS_DENIED — never retried, never bypassed", async () => {
    const page = fakePage({ goto: vi.fn().mockResolvedValue({ status: () => 403 }) });
    await expect(navigateSafely(page, "https://divar.ir/v/x", 5000)).rejects.toMatchObject({
      category: "ACCESS_DENIED",
    });
  });

  it("classifies CAPTCHA-marker page content as CAPTCHA", async () => {
    const page = fakePage({
      goto: vi.fn().mockResolvedValue({ status: () => 200 }),
      evaluate: vi.fn().mockResolvedValue("please verify with arcaptcha to continue"),
    });
    await expect(navigateSafely(page, "https://divar.ir/v/x", 5000)).rejects.toMatchObject({
      category: "CAPTCHA",
    });
  });

  it("classifies a Playwright timeout error as NAVIGATION_TIMEOUT", async () => {
    const page = fakePage({
      goto: vi.fn().mockRejectedValue(new Error("page.goto: Timeout 5000ms exceeded")),
    });
    await expect(navigateSafely(page, "https://divar.ir/v/x", 5000)).rejects.toMatchObject({
      category: "NAVIGATION_TIMEOUT",
    });
  });

  it("classifies an unexpected navigation crash as BROWSER_ERROR", async () => {
    const page = fakePage({
      goto: vi.fn().mockRejectedValue(new Error("net::ERR_CONNECTION_RESET")),
    });
    await expect(navigateSafely(page, "https://divar.ir/v/x", 5000)).rejects.toMatchObject({
      category: "BROWSER_ERROR",
    });
  });

  it("classifies a null response (e.g. about:blank) as BROWSER_ERROR rather than silently succeeding", async () => {
    const page = fakePage({ goto: vi.fn().mockResolvedValue(null) });
    await expect(navigateSafely(page, "https://divar.ir/v/x", 5000)).rejects.toMatchObject({
      category: "BROWSER_ERROR",
    });
  });
});

describe("CircuitBreaker", () => {
  it("stays closed until a hard-stop error is recorded", () => {
    const breaker = new CircuitBreaker();
    breaker.recordError(new IngestionError("NAVIGATION_TIMEOUT", "timeout"));
    expect(breaker.isOpen).toBe(false);
    expect(() => breaker.guard()).not.toThrow();
  });

  it("opens on ACCESS_DENIED and blocks every subsequent guard() without touching the network again", () => {
    const breaker = new CircuitBreaker();
    breaker.recordError(new IngestionError("ACCESS_DENIED", "403"));
    expect(breaker.isOpen).toBe(true);
    expect(() => breaker.guard()).toThrow(IngestionError);
    expect(() => breaker.guard()).toThrow(IngestionError); // still open on a second call
  });

  it("opens on CAPTCHA", () => {
    const breaker = new CircuitBreaker();
    breaker.recordError(new IngestionError("CAPTCHA", "challenge"));
    expect(breaker.isOpen).toBe(true);
  });

  it("ignores a non-Error value passed to recordError", () => {
    const breaker = new CircuitBreaker();
    breaker.recordError("not an error");
    expect(breaker.isOpen).toBe(false);
  });
});

describe("BrowserManager", () => {
  it("reuses the same browser instance across multiple withPage calls", async () => {
    const launch = vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(fakePage()),
      close: vi.fn().mockResolvedValue(undefined),
    } satisfies Partial<Browser>);
    const manager = new BrowserManager({ launch: launch as () => Promise<Browser> });

    await manager.withPage(() => Promise.resolve(undefined));
    await manager.withPage(() => Promise.resolve(undefined));

    expect(launch).toHaveBeenCalledTimes(1);
    await manager.close();
  });

  it("launches exactly once when multiple withPage calls race concurrently (concurrent job dispatch)", async () => {
    // Mirrors apps/worker's real shape: job-dispatcher.ts's processClaimedJobs runs claimed jobs
    // concurrently via Promise.all, and every collect_divar job shares the one BrowserManager
    // instance constructed in apps/worker/src/index.ts. This proves getBrowser()'s
    // `browserPromise ??= this.launchFn()` correctly collapses concurrent racers onto the same
    // in-flight launch — never launching (or CDP-connecting) more than once — and that each
    // concurrent caller still gets its own page, never sharing one page across jobs.
    let resolveLaunch!: (browser: Browser) => void;
    const launch = vi.fn(
      () =>
        new Promise<Browser>((resolve) => {
          resolveLaunch = resolve;
        }),
    );
    const newPageCalls: Page[] = [];
    const fakeBrowser = {
      newPage: vi.fn(() => {
        const page = fakePage();
        newPageCalls.push(page);
        return Promise.resolve(page);
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Browser;
    const manager = new BrowserManager({ launch });

    const concurrentCalls = [
      manager.withPage(() => Promise.resolve("a")),
      manager.withPage(() => Promise.resolve("b")),
      manager.withPage(() => Promise.resolve("c")),
    ];
    // All three have already called getBrowser() and are awaiting the same in-flight promise
    // before the launch resolves — this is the race the test exists to prove is handled safely.
    resolveLaunch(fakeBrowser);
    const results = await Promise.all(concurrentCalls);

    expect(launch).toHaveBeenCalledTimes(1);
    expect(results).toEqual(["a", "b", "c"]);
    expect(newPageCalls).toHaveLength(3); // one distinct page per concurrent job, never shared
    await manager.close();
  });

  it("always closes the page, even when the callback throws", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const launch = vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(fakePage({ close })),
      close: vi.fn().mockResolvedValue(undefined),
    } satisfies Partial<Browser>);
    const manager = new BrowserManager({ launch: launch as () => Promise<Browser> });

    await expect(manager.withPage(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(close).toHaveBeenCalledTimes(1);
    await manager.close();
  });

  it("wraps a launch failure as a BROWSER_ERROR IngestionError", async () => {
    const launch = vi.fn().mockRejectedValue(new Error("no chromium binary"));
    const manager = new BrowserManager({ launch: launch as () => Promise<Browser> });

    await expect(manager.withPage(() => Promise.resolve(undefined))).rejects.toMatchObject({
      category: "BROWSER_ERROR",
    });
  });
});

describe("createLocalChromiumLaunch", () => {
  it("launches headless chromium with no chromiumSandbox key when unspecified", async () => {
    const fakeBrowser = { close: vi.fn() } as unknown as Browser;
    vi.mocked(chromium.launch).mockResolvedValue(fakeBrowser);

    const launch = createLocalChromiumLaunch();
    const result = await launch();

    expect(result).toBe(fakeBrowser);
    expect(chromium.launch).toHaveBeenCalledWith({ headless: true });
  });

  it("passes chromiumSandbox: false through for the Docker collector", async () => {
    vi.mocked(chromium.launch).mockResolvedValue({} as Browser);

    const launch = createLocalChromiumLaunch({ chromiumSandbox: false });
    await launch();

    expect(chromium.launch).toHaveBeenCalledWith({ headless: true, chromiumSandbox: false });
  });
});

describe("createCloudflareCdpLaunch", () => {
  it("connects via chromium.connectOverCDP with the account's wss endpoint and a bearer token", async () => {
    const fakeBrowser = { close: vi.fn() } as unknown as Browser;
    vi.mocked(chromium.connectOverCDP).mockResolvedValue(fakeBrowser);

    const launch = createCloudflareCdpLaunch({ accountId: "acct123", apiToken: "tok456" });
    const result = await launch();

    expect(result).toBe(fakeBrowser);
    expect(chromium.connectOverCDP).toHaveBeenCalledWith(
      "wss://api.cloudflare.com/client/v4/accounts/acct123/browser-rendering/devtools/browser?keep_alive=600000",
      { headers: { Authorization: "Bearer tok456" } },
    );
  });

  it("honors a custom keepAliveMs instead of the default", async () => {
    vi.mocked(chromium.connectOverCDP).mockResolvedValue({} as Browser);

    const launch = createCloudflareCdpLaunch({
      accountId: "acct123",
      apiToken: "tok456",
      keepAliveMs: 30_000,
    });
    await launch();

    expect(chromium.connectOverCDP).toHaveBeenCalledWith(
      expect.stringContaining("keep_alive=30000"),
      expect.anything(),
    );
  });

  it("propagates a connection failure so BrowserManager wraps it as BROWSER_ERROR", async () => {
    vi.mocked(chromium.connectOverCDP).mockRejectedValue(new Error("401 Unauthorized"));

    const launch = createCloudflareCdpLaunch({ accountId: "acct123", apiToken: "bad-token" });
    const manager = new BrowserManager({ launch });

    await expect(manager.withPage(() => Promise.resolve(undefined))).rejects.toMatchObject({
      category: "BROWSER_ERROR",
    });
  });
});
