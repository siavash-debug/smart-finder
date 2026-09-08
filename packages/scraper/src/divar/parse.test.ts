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

/** A trimmed, sanitized reconstruction of the real fields observed against a real sale listing,
 *  `https://divar.ir/v/gaZCzuna`, during the Docker-collector verification — the same real-DOM
 *  methodology as `realListingFixture()` above, for a sale (not rent) posting. Confirms the
 *  info-row price label is "قیمت کل" here, never "ودیعه". */
function realSaleListingFixture(): RawDivarDetailPage {
  return {
    requestedUrl: "https://divar.ir/v/gaZCzuna",
    canonicalUrl: "https://divar.ir/v/gaZCzuna",
    title: "۹۰مترفول امکانات نوساز /تکواحدی/ سلسبیل بالای سپه",
    jsonLdDescription: null,
    infoRows: {
      "تصویر‌ها برای همین ملک است؟": "بله",
      "قیمت کل": "‏۲۱,۵۰۰,۰۰۰,۰۰۰ تومان",
      "قیمت هر متر": "‏۲۳۸,۸۸۸,۰۰۰ تومان",
      طبقه: "۱ از ۴",
    },
    groupRow: {
      headers: ["متراژ", "ساخت", "اتاق"],
      values: ["۹۰", "۱۴۰۵", "۲"],
    },
    bodyText: "",
  };
}

/** A full rent info-row set, covering every rent-specific label this phase requires:
 *  ودیعه, اجارهٔ ماهانه ("رایگان" — a deposit-only rental, free monthly rent), ودیعه و اجاره
 *  ("غیر قابل تبدیل" — not convertible), طبقه. */
function fullRentInfoRows(): Record<string, string> {
  return {
    ودیعه: "‏۲,۶۰۰,۰۰۰,۰۰۰ تومان",
    "اجارهٔ ماهانه": "رایگان",
    "ودیعه و اجاره": "غیر قابل تبدیل",
    طبقه: "۲ از ۶",
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

  it("pulls ودیعه/طبقه from the info rows (rent listing)", () => {
    const parsed = parseDivarDetailPage(realListingFixture());
    expect(parsed?.priceRaw).toBe("‏۴,۱۰۰,۰۰۰,۰۰۰ تومان");
    expect(parsed?.floorRaw).toBe("۳ از ۵");
  });

  it("pulls قیمت کل/طبقه from the info rows (sale listing) — not ودیعه, which never appears on a sale page", () => {
    const parsed = parseDivarDetailPage(realSaleListingFixture());
    expect(parsed?.priceRaw).toBe("‏۲۱,۵۰۰,۰۰۰,۰۰۰ تومان");
    expect(parsed?.floorRaw).toBe("۱ از ۴");
  });

  it("does not regress area/rooms/building-age/id extraction for a sale listing", () => {
    const parsed = parseDivarDetailPage(realSaleListingFixture());
    expect(parsed?.sourcePostingId).toBe("gaZCzuna");
    expect(parsed?.areaRaw).toBe("۹۰");
    expect(parsed?.roomsRaw).toBe("۲");
    expect(parsed?.buildingAgeYearRaw).toBe("۱۴۰۵");
  });

  it("prefers ودیعه over قیمت کل if a page somehow had both (rent takes priority, never both in practice)", () => {
    const raw = {
      ...realListingFixture(),
      infoRows: { ...realListingFixture().infoRows, "قیمت کل": "‏۹۹۹,۰۰۰,۰۰۰ تومان" },
    };
    const parsed = parseDivarDetailPage(raw);
    expect(parsed?.priceRaw).toBe("‏۴,۱۰۰,۰۰۰,۰۰۰ تومان");
  });

  it("leaves priceRaw null (not a guess) when a sale listing has neither price label", () => {
    const raw = { ...realSaleListingFixture(), infoRows: { طبقه: "۱ از ۴" } };
    const parsed = parseDivarDetailPage(raw);
    expect(parsed?.priceRaw).toBeNull();
    expect(parsed?.floorRaw).toBe("۱ از ۴");
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

  describe("semantic extraction — rent's full field set", () => {
    it("extracts deposit, monthly rent (رایگان preserved as-is, never coerced to 0), convertibility, and floor", () => {
      const raw = { ...realListingFixture(), infoRows: fullRentInfoRows() };
      const parsed = parseDivarDetailPage(raw);

      expect(parsed?.priceRaw).toBe("‏۲,۶۰۰,۰۰۰,۰۰۰ تومان"); // deposit → priceRaw, established precedent
      expect(parsed?.monthlyRentRaw).toBe("رایگان");
      expect(parsed?.rentConvertibilityRaw).toBe("غیر قابل تبدیل");
      expect(parsed?.floorRaw).toBe("۲ از ۶");
      expect(parsed?.salePricePerSqmRaw).toBeNull(); // never populated for a rent listing
    });

    it("classifies اجاره ماهانه (no combining hamza) identically to اجارهٔ ماهانه — real wording variation", () => {
      const withHamza = parseDivarDetailPage({
        ...realListingFixture(),
        infoRows: { "اجارهٔ ماهانه": "رایگان" },
      });
      const withoutHamza = parseDivarDetailPage({
        ...realListingFixture(),
        infoRows: { "اجاره ماهانه": "رایگان" },
      });

      expect(withHamza?.monthlyRentRaw).toBe("رایگان");
      expect(withoutHamza?.monthlyRentRaw).toBe("رایگان");
    });
  });

  describe("semantic extraction — sale's price-per-sqm never overwrites the total price", () => {
    it("keeps قیمت کل and قیمت هر متر as distinct fields using the real observed example values", () => {
      const raw: RawDivarDetailPage = {
        ...realSaleListingFixture(),
        infoRows: {
          "قیمت کل": "‏۲۱,۲۰۰,۰۰۰,۰۰۰ تومان",
          "قیمت هر متر": "‏۳۰۲,۸۵۷,۰۰۰ تومان",
          طبقه: "۱ از ۴",
        },
      };
      const parsed = parseDivarDetailPage(raw);

      expect(parsed?.priceRaw).toBe("‏۲۱,۲۰۰,۰۰۰,۰۰۰ تومان");
      expect(parsed?.salePricePerSqmRaw).toBe("‏۳۰۲,۸۵۷,۰۰۰ تومان");
      expect(parsed?.priceRaw).not.toBe(parsed?.salePricePerSqmRaw);
      expect(parsed?.monthlyRentRaw).toBeNull(); // never populated for a sale listing
      expect(parsed?.rentConvertibilityRaw).toBeNull();
    });
  });

  describe("resilience — harmless label/value variation must not break extraction", () => {
    it("Persian vs Arabic digit forms in the value don't affect which field it lands in", () => {
      const arabicDigitPrice = "21,200,000,000 تومان"; // ASCII/Arabic-Indic digit style
      const raw = {
        ...realSaleListingFixture(),
        infoRows: { "قیمت کل": arabicDigitPrice },
      };
      expect(parseDivarDetailPage(raw)?.priceRaw).toBe(arabicDigitPrice);
    });

    it("zero-width characters inside a label still classify and extract correctly", () => {
      const zwnj = "‌";
      const raw = {
        ...realSaleListingFixture(),
        infoRows: { [`قیمت${zwnj} کل`]: "‏۲۱,۲۰۰,۰۰۰,۰۰۰ تومان" },
      };
      expect(parseDivarDetailPage(raw)?.priceRaw).toBe("‏۲۱,۲۰۰,۰۰۰,۰۰۰ تومان");
    });

    it("label ordering in the raw infoRows object doesn't change which field wins", () => {
      const forwardOrder = { ودیعه: "A", "اجارهٔ ماهانه": "B", طبقه: "C" };
      const reverseOrder = { طبقه: "C", "اجارهٔ ماهانه": "B", ودیعه: "A" };
      const a = parseDivarDetailPage({ ...realListingFixture(), infoRows: forwardOrder });
      const b = parseDivarDetailPage({ ...realListingFixture(), infoRows: reverseOrder });
      expect(a?.priceRaw).toBe(b?.priceRaw);
      expect(a?.monthlyRentRaw).toBe(b?.monthlyRentRaw);
      expect(a?.floorRaw).toBe(b?.floorRaw);
    });

    it("an additional, unknown info row alongside known ones doesn't disturb extraction", () => {
      const raw = {
        ...realListingFixture(),
        infoRows: { ...realListingFixture().infoRows, "یک برچسب ناشناخته": "مقدار ناشناخته" },
      };
      const parsed = parseDivarDetailPage(raw);
      expect(parsed?.priceRaw).toBe("‏۴,۱۰۰,۰۰۰,۰۰۰ تومان");
      expect(parsed?.floorRaw).toBe("۳ از ۵");
    });

    it("missing optional rows (only some fields present) leave the rest safely null, not a guess", () => {
      const raw = { ...realListingFixture(), infoRows: { طبقه: "۳ از ۵" } };
      const parsed = parseDivarDetailPage(raw);
      expect(parsed?.floorRaw).toBe("۳ از ۵");
      expect(parsed?.priceRaw).toBeNull();
      expect(parsed?.monthlyRentRaw).toBeNull();
      expect(parsed?.rentConvertibilityRaw).toBeNull();
      expect(parsed?.salePricePerSqmRaw).toBeNull();
    });
  });
});
