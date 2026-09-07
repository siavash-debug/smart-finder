import { describe, expect, it } from "vitest";

import { parseDivarDetailPage } from "./parse.js";
import type { RawDivarDetailPage } from "./types.js";

/** A trimmed, sanitized reconstruction of the real fields observed against
 *  `https://divar.ir/v/gaSebQzv` during the Phase 5 access spike (ADR-0016) — not raw HTML,
 *  just the label/value data the adapter's DOM extraction actually returns. */
function realListingFixture(): RawDivarDetailPage {
  return {
    requestedUrl: "https://divar.ir/v/gaSebQzv",
    canonicalUrl: "https://divar.ir/v/۱۱۰-متر-تک-واحدی-تخلیه-سعادت-آباد-صراف-ها/gaSebQzv",
    title: "۱۱۰ متر تک‌واحدی * تخلیه *سعادت‌آباد* صراف‌ها",
    jsonLdDescription:
      "اجاره ۱۱۰ متر | ۲ خواب | صراف‌های جنوبی\n۴طبقه تک‌واحدی | طبقه سوم\n۱۰ سال ساخت",
    infoRows: {
      ودیعه: "‏۴,۱۰۰,۰۰۰,۰۰۰ تومان",
      طبقه: "۳ از ۵",
    },
    groupRow: {
      headers: ["متراژ", "ساخت", "اتاق"],
      values: ["۱۱۰", "۱۳۹۵", "۲"],
    },
    bodyText: "ویژگی‌ها و امکانات آسانسور پارکینگ انباری ندارد",
  };
}

describe("parseDivarDetailPage", () => {
  it("extracts the posting id from the canonical JSON-LD url over the requested url", () => {
    const parsed = parseDivarDetailPage(realListingFixture());
    expect(parsed?.sourcePostingId).toBe("gaSebQzv");
  });

  it("falls back to the requested url's id when no canonical url is present", () => {
    const raw = { ...realListingFixture(), canonicalUrl: null };
    const parsed = parseDivarDetailPage(raw);
    expect(parsed?.sourcePostingId).toBe("gaSebQzv");
  });

  it("returns null when neither url yields a posting id", () => {
    const raw = {
      ...realListingFixture(),
      canonicalUrl: null,
      requestedUrl: "https://divar.ir/s/tehran",
    };
    expect(parseDivarDetailPage(raw)).toBeNull();
  });

  it("pulls متراژ/ساخت/اتاق from the group row by label, not by position alone", () => {
    const parsed = parseDivarDetailPage(realListingFixture());
    expect(parsed?.areaRaw).toBe("۱۱۰");
    expect(parsed?.buildingAgeYearRaw).toBe("۱۳۹۵");
    expect(parsed?.roomsRaw).toBe("۲");
  });

  it("pulls ودیعه/طبقه from the info rows", () => {
    const parsed = parseDivarDetailPage(realListingFixture());
    expect(parsed?.priceRaw).toBe("‏۴,۱۰۰,۰۰۰,۰۰۰ تومان");
    expect(parsed?.floorRaw).toBe("۳ از ۵");
  });

  it("returns null (not a guess) for a field that never appeared in the group row", () => {
    const raw = { ...realListingFixture(), groupRow: null };
    const parsed = parseDivarDetailPage(raw);
    expect(parsed?.areaRaw).toBeNull();
    expect(parsed?.buildingAgeYearRaw).toBeNull();
    expect(parsed?.roomsRaw).toBeNull();
  });

  it("returns null (not a guess) for a field that never appeared in the info rows", () => {
    const raw = { ...realListingFixture(), infoRows: {} };
    const parsed = parseDivarDetailPage(raw);
    expect(parsed?.priceRaw).toBeNull();
    expect(parsed?.floorRaw).toBeNull();
  });

  it("carries the full body text through untouched for amenity scanning", () => {
    const parsed = parseDivarDetailPage(realListingFixture());
    expect(parsed?.amenitiesText).toContain("آسانسور");
    expect(parsed?.amenitiesText).toContain("انباری ندارد");
  });
});
