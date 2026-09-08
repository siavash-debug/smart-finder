import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";

import { DivarAdapter, parseJsonLdBlocks } from "./adapter.js";
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
    reload: vi.fn().mockResolvedValue(null),
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
  it("returns the raw extracted fields with the requested url attached, parsing an array-wrapped JSON-LD block (real gaYq3kUB shape)", async () => {
    const adapter = new DivarAdapter(5000);
    const jsonLdTexts = [
      JSON.stringify([
        {
          floorSize: { "@type": "QuantitativeValue", value: "130", unitCode: "MTK" },
          description: "با سلام فول امکانات\nسه خوابه",
          url: "https://divar.ir/v/گاYq3kUB-slug/gaYq3kUB",
        },
      ]),
    ];
    const extracted = {
      title: "۱۱۰ متر",
      jsonLdTexts,
      infoRows: {},
      groupRow: null,
      bodyText: "",
    };
    const page = fakePage({
      evaluate: vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce(extracted),
    });

    const raw = await adapter.fetch(page, {
      sourcePostingId: "gaYq3kUB",
      url: "https://divar.ir/v/gaYq3kUB",
    });

    expect(raw).toEqual({
      requestedUrl: "https://divar.ir/v/gaYq3kUB",
      title: "۱۱۰ متر",
      infoRows: {},
      groupRow: null,
      bodyText: "",
      canonicalUrl: "https://divar.ir/v/گاYq3kUB-slug/gaYq3kUB",
      jsonLdDescription: "با سلام فول امکانات\nسه خوابه",
    });
  });

  describe("info-row readiness retry (ADR-0021)", () => {
    it("does not reload when the info-row selector resolves on the first attempt", async () => {
      const reload = vi.fn().mockResolvedValue(null);
      const waitForSelector = vi.fn().mockResolvedValue(null); // always succeeds
      const page = fakePage({
        reload,
        waitForSelector,
        evaluate: vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce({
          title: "t",
          jsonLdTexts: [],
          infoRows: {},
          groupRow: null,
          bodyText: "",
        }),
      });
      const adapter = new DivarAdapter(20_000);

      await adapter.fetch(page, { sourcePostingId: "x", url: "https://divar.ir/v/x" });

      expect(reload).not.toHaveBeenCalled();
    });

    it("reloads once and retries the info-row wait when the first attempt times out, still completing extraction", async () => {
      const reload = vi.fn().mockResolvedValue(null);
      // First call (title wait) succeeds; second call (info-row, 1st attempt) fails; third
      // call (info-row, 2nd attempt after reload) succeeds.
      const waitForSelector = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error("Timeout"))
        .mockResolvedValueOnce(null);
      const page = fakePage({
        reload,
        waitForSelector,
        evaluate: vi
          .fn()
          .mockResolvedValueOnce("")
          .mockResolvedValueOnce({
            title: "t",
            jsonLdTexts: [],
            infoRows: { طبقه: "۲ از ۵" },
            groupRow: null,
            bodyText: "",
          }),
      });
      const adapter = new DivarAdapter(20_000);

      const raw = await adapter.fetch(page, { sourcePostingId: "x", url: "https://divar.ir/v/x" });

      expect(reload).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledWith(
        expect.objectContaining({ waitUntil: "domcontentloaded" }),
      );
      expect(waitForSelector).toHaveBeenCalledTimes(3);
      expect(raw.infoRows).toEqual({ طبقه: "۲ از ۵" });
    });

    it("proceeds gracefully (never throws) when both attempts time out — a genuinely absent field, not an error", async () => {
      const reload = vi.fn().mockResolvedValue(null);
      const waitForSelector = vi
        .fn()
        .mockResolvedValueOnce(null) // title wait succeeds
        .mockRejectedValueOnce(new Error("Timeout")) // info-row attempt 1 fails
        .mockRejectedValueOnce(new Error("Timeout")); // info-row attempt 2 (after reload) fails
      const page = fakePage({
        reload,
        waitForSelector,
        evaluate: vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce({
          title: "t",
          jsonLdTexts: [],
          infoRows: {},
          groupRow: null,
          bodyText: "",
        }),
      });
      const adapter = new DivarAdapter(20_000);

      const raw = await adapter.fetch(page, { sourcePostingId: "x", url: "https://divar.ir/v/x" });

      expect(reload).toHaveBeenCalledTimes(1);
      expect(raw.infoRows).toEqual({});
    });

    it("proceeds gracefully even if the reload itself fails (e.g. a network hiccup on the retry)", async () => {
      const reload = vi.fn().mockRejectedValue(new Error("net::ERR_CONNECTION_RESET"));
      const waitForSelector = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error("Timeout"))
        .mockRejectedValueOnce(new Error("Timeout"));
      const page = fakePage({
        reload,
        waitForSelector,
        evaluate: vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce({
          title: "t",
          jsonLdTexts: [],
          infoRows: {},
          groupRow: null,
          bodyText: "",
        }),
      });
      const adapter = new DivarAdapter(20_000);

      await expect(
        adapter.fetch(page, { sourcePostingId: "x", url: "https://divar.ir/v/x" }),
      ).resolves.toBeDefined();
    });

    it("splits the retry budget so the combined worst case stays bounded by the configured timeout, not doubled", async () => {
      const waitForSelector = vi.fn().mockResolvedValue(null);
      const page = fakePage({
        waitForSelector,
        evaluate: vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce({
          title: "t",
          jsonLdTexts: [],
          infoRows: {},
          groupRow: null,
          bodyText: "",
        }),
      });
      const adapter = new DivarAdapter(20_000);

      await adapter.fetch(page, { sourcePostingId: "x", url: "https://divar.ir/v/x" });

      // Title wait uses the full configured timeout; the info-row wait uses half of it (two
      // attempts of half each keep the worst case comparable to a single full-timeout wait,
      // not additive on top of it).
      expect(waitForSelector).toHaveBeenNthCalledWith(1, expect.anything(), { timeout: 20_000 });
      expect(waitForSelector).toHaveBeenNthCalledWith(2, expect.anything(), { timeout: 10_000 });
    });
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

describe("parseJsonLdBlocks", () => {
  it("extracts description and canonical url from an array-wrapped JSON-LD block (real gaYq3kUB shape)", () => {
    const jsonLdTexts = [
      JSON.stringify([
        {
          floorSize: { "@type": "QuantitativeValue", value: "130", unitCode: "MTK" },
          description:
            "با سلام فول امکانات\nسه خوابه\nموقعیت مسکونی\nنورکَیر\nدو واحدی\nکابینت ممبران\nاینه کاری دیوار\nدارای جاکفشی آینه دار قَدی\nدارای لوستر های یذیرایی\nدارای انباری و بالکن\nدارای کابینت ممبران جادار\nشیک تمیز\nساعت بازدید ۶ بعدظهر قبلش تماس کرفته شود نبش ساختمان المپ بلوک G",
          url: "https://divar.ir/v/آیارتمان-130متری3-خوابه-موقعیت-مسکونی-نازی-اباد/gaYq3kUB",
        },
      ]),
    ];

    const { canonicalUrl, description } = parseJsonLdBlocks(jsonLdTexts);

    expect(canonicalUrl).toBe(
      "https://divar.ir/v/آیارتمان-130متری3-خوابه-موقعیت-مسکونی-نازی-اباد/gaYq3kUB",
    );
    expect(description).toContain("با سلام فول امکانات");
    expect(description).toContain("نبش ساختمان المپ بلوک G");
  });

  it("still extracts description/url from a bare (non-array-wrapped) JSON-LD block — no regression", () => {
    const jsonLdTexts = [
      JSON.stringify({
        floorSize: { "@type": "QuantitativeValue", value: "110", unitCode: "MTK" },
        description: "اجاره ۱۱۰ متر | ۲ خواب",
        url: "https://divar.ir/v/۱۱۰-متر/gaSebQzv",
      }),
    ];

    const { canonicalUrl, description } = parseJsonLdBlocks(jsonLdTexts);

    expect(canonicalUrl).toBe("https://divar.ir/v/۱۱۰-متر/gaSebQzv");
    expect(description).toBe("اجاره ۱۱۰ متر | ۲ خواب");
  });

  it("preserves multiline description formatting (newlines) exactly, without cleaning or summarizing", () => {
    const multiline = "خط اول\nخط دوم\n\nخط چهارم بعد از خط خالی";
    const jsonLdTexts = [
      JSON.stringify([{ floorSize: {}, description: multiline, url: "https://divar.ir/v/x" }]),
    ];

    expect(parseJsonLdBlocks(jsonLdTexts).description).toBe(multiline);
  });

  it("ignores an unrelated block (e.g. BreadcrumbList, no floorSize) and only reads the Apartment/Product block", () => {
    const breadcrumb = JSON.stringify({
      "@type": "BreadcrumbList",
      itemListElement: [{ "@type": "ListItem", position: 1, item: { name: "دیوار" } }],
    });
    const apartment = JSON.stringify([
      { floorSize: {}, description: "توضیحات واقعی آگهی", url: "https://divar.ir/v/gaYq3kUB" },
    ]);

    const { description, canonicalUrl } = parseJsonLdBlocks([breadcrumb, apartment]);

    expect(description).toBe("توضیحات واقعی آگهی");
    expect(canonicalUrl).toBe("https://divar.ir/v/gaYq3kUB");
  });

  it("returns null (not a guess) when no block has both floorSize and description", () => {
    const breadcrumbOnly = JSON.stringify({ "@type": "BreadcrumbList", itemListElement: [] });
    expect(parseJsonLdBlocks([breadcrumbOnly]).description).toBeNull();
    expect(parseJsonLdBlocks([]).description).toBeNull();
  });

  it("skips a malformed JSON-LD block without throwing, still reading a later valid one", () => {
    const malformed = "{ not valid json";
    const valid = JSON.stringify([
      { floorSize: {}, description: "توضیحات سالم", url: "https://divar.ir/v/gaYq3kUB" },
    ]);

    expect(parseJsonLdBlocks([malformed, valid]).description).toBe("توضیحات سالم");
  });

  it("does not mistake a bare description-less object for a match (floorSize present but description missing)", () => {
    const jsonLdTexts = [JSON.stringify([{ floorSize: {}, url: "https://divar.ir/v/gaYq3kUB" }])];
    const result = parseJsonLdBlocks(jsonLdTexts);
    expect(result.description).toBeNull();
    expect(result.canonicalUrl).toBe("https://divar.ir/v/gaYq3kUB");
  });
});
