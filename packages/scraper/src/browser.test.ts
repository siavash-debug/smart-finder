import { describe, expect, it, vi } from "vitest";
import type { Browser, Page } from "playwright";

import { BrowserManager, CircuitBreaker, navigateSafely } from "./browser.js";
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
