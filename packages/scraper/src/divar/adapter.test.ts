import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";

import { DivarAdapter } from "./adapter.js";
import { IngestionError } from "../errors.js";

const LISTING_HREFS = [
  "/v/80متری-دو-خواب-غرق-نور/gaemYCJC",
  "/v/جمهوری-بین-چهارراه-سی-تیر/gakd_Oo3",
  "/v/gaSebQzv", // bare form of the same posting reachable via a different href shape
];

function fakePage(overrides: Partial<Page> = {}): Page {
  return {
    goto: vi.fn().mockResolvedValue({ status: () => 200 }),
    waitForSelector: vi.fn().mockResolvedValue(null),
    $$eval: vi.fn().mockResolvedValue(LISTING_HREFS),
    // navigateSafely's own CAPTCHA-marker check calls evaluate first (expects a string); a
    // caller that also uses evaluate for its own extraction can override this default.
    evaluate: vi.fn().mockResolvedValue(""),
    ...overrides,
  } as unknown as Page;
}

describe("DivarAdapter.discover", () => {
  it("extracts one DiscoveredListing per unique posting id, ignoring hrefs with no id", async () => {
    const adapter = new DivarAdapter(5000);
    const page = fakePage({
      $$eval: vi.fn().mockResolvedValue([...LISTING_HREFS, "/s/tehran/rent-apartment"]),
    });

    const listings = await adapter.discover(page, "https://divar.ir/s/tehran/rent-apartment");

    expect(listings).toHaveLength(3);
    expect(listings.map((l) => l.sourcePostingId).sort()).toEqual([
      "gaSebQzv",
      "gaemYCJC",
      "gakd_Oo3",
    ]);
  });

  it("produces the bare canonical url for every discovered listing", async () => {
    const adapter = new DivarAdapter(5000);
    const page = fakePage();

    const listings = await adapter.discover(page, "https://divar.ir/s/tehran/rent-apartment");

    for (const listing of listings) {
      expect(listing.url).toBe(`https://divar.ir/v/${listing.sourcePostingId}`);
    }
  });

  it("propagates an ACCESS_DENIED navigation failure rather than returning an empty list", async () => {
    const adapter = new DivarAdapter(5000);
    const page = fakePage({ goto: vi.fn().mockResolvedValue({ status: () => 403 }) });

    await expect(
      adapter.discover(page, "https://divar.ir/s/tehran/rent-apartment"),
    ).rejects.toMatchObject({ category: "ACCESS_DENIED" });
  });
});

describe("DivarAdapter.fetch", () => {
  it("returns the raw extracted fields with the requested url attached", async () => {
    const adapter = new DivarAdapter(5000);
    const extracted = {
      canonicalUrl: "https://divar.ir/v/gaSebQzv",
      title: "۱۱۰ متر",
      jsonLdDescription: null,
      infoRows: {},
      groupRow: null,
      bodyText: "",
    };
    const page = fakePage({
      evaluate: vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce(extracted),
    });

    const raw = await adapter.fetch(page, {
      sourcePostingId: "gaSebQzv",
      url: "https://divar.ir/v/gaSebQzv",
    });

    expect(raw).toEqual({ requestedUrl: "https://divar.ir/v/gaSebQzv", ...extracted });
  });
});

describe("DivarAdapter.parse", () => {
  it("throws a classified PARSE_ERROR when no posting id can be determined", () => {
    const adapter = new DivarAdapter(5000);
    const raw = {
      requestedUrl: "https://divar.ir/s/tehran",
      canonicalUrl: null,
      title: null,
      jsonLdDescription: null,
      infoRows: {},
      groupRow: null,
      bodyText: "",
    };

    expect(() => adapter.parse(raw)).toThrow(IngestionError);
    expect(() => adapter.parse(raw)).toThrow(expect.objectContaining({ category: "PARSE_ERROR" }));
  });
});
