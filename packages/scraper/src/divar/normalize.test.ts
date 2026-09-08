import { describe, expect, it } from "vitest";

import { normalizeDivarFields } from "./normalize.js";
import { parseDivarDetailPage } from "./parse.js";
import type { ListingContext } from "../types.js";
import type { RawDivarDetailPage } from "./types.js";

const REAL_LISTING: RawDivarDetailPage = {
  requestedUrl: "https://divar.ir/v/gaSebQzv",
  canonicalUrl: "https://divar.ir/v/۱۱۰-متر-تک-واحدی-تخلیه-سعادت-آباد-صراف-ها/gaSebQzv",
  title: "۱۱۰ متر تک‌واحدی * تخلیه *سعادت‌آباد* صراف‌ها",
  jsonLdDescription: "اجاره ۱۱۰ متر | ۲ خواب | صراف‌های جنوبی",
  infoRows: { ودیعه: "‏۴,۱۰۰,۰۰۰,۰۰۰ تومان", طبقه: "۳ از ۵" },
  groupRow: { headers: ["متراژ", "ساخت", "اتاق"], values: ["۱۱۰", "۱۳۹۵", "۲"] },
  bodyText: "آسانسور پارکینگ انباری ندارد",
};

const RENT_CONTEXT: ListingContext = { transactionType: "rent", propertyType: "apartment" };

/** 2026-09-07 is Jalali ۱۴۰۵-۰۶-۱۶ — chosen as the reference date specifically because it
 *  reproduces the real listing's own "۱۰ سال ساخت" claim from ۱۳۹۵, letting this test check
 *  against genuine real-world data instead of an arbitrary made-up date. */
const REFERENCE_DATE = new Date("2026-09-07T00:00:00Z");

function normalizeFixture(raw: RawDivarDetailPage) {
  const parsed = parseDivarDetailPage(raw);
  if (parsed === null) throw new Error("fixture must parse");
  return normalizeDivarFields(parsed, RENT_CONTEXT, REFERENCE_DATE);
}

describe("normalizeDivarFields", () => {
  it("carries a non-empty real description through untouched — raw source text, not run through any semantic parser", () => {
    const result = normalizeFixture(REAL_LISTING);
    expect(result.description).toBe("اجاره ۱۱۰ متر | ۲ خواب | صراف‌های جنوبی");
  });

  it("preserves a multiline description's newlines exactly, for both sale and rent contexts", () => {
    const multiline = "خط اول\nخط دوم\n\nخط چهارم";
    const raw: RawDivarDetailPage = { ...REAL_LISTING, jsonLdDescription: multiline };
    const parsed = parseDivarDetailPage(raw);
    if (parsed === null) throw new Error("fixture must parse");

    const rentResult = normalizeDivarFields(parsed, RENT_CONTEXT, REFERENCE_DATE);
    const saleResult = normalizeDivarFields(
      parsed,
      { transactionType: "sale", propertyType: "apartment" },
      REFERENCE_DATE,
    );
    expect(rentResult.description).toBe(multiline);
    expect(saleResult.description).toBe(multiline);
  });

  it("parses the real listing's price via parseMoney, RLM mark and all", () => {
    const result = normalizeFixture(REAL_LISTING);
    expect(result.priceToman).toBe(4_100_000_000n);
  });

  it("parses متراژ/اتاق as bare integers using the group row's own label", () => {
    const result = normalizeFixture(REAL_LISTING);
    expect(result.areaSqm).toBe(110);
    expect(result.rooms).toBe(2);
  });

  it("parses طبقه via parseFloor's 'X از Y' form", () => {
    const result = normalizeFixture(REAL_LISTING);
    expect(result.floor).toBe(3);
    expect(result.totalFloors).toBe(5);
  });

  it("converts the absolute Jalali construction year to a relative age using referenceDate", () => {
    const result = normalizeFixture(REAL_LISTING);
    expect(result.buildingAgeYears).toBe(10);
  });

  it("reads amenities via parseAttribute: bare mention true, explicit negation false", () => {
    const result = normalizeFixture(REAL_LISTING);
    expect(result.hasElevator).toBe(true);
    expect(result.hasParking).toBe(true);
    expect(result.hasStorage).toBe(false);
  });

  it("never mentioned amenity stays unknown (undefined), never guessed false", () => {
    const raw = { ...REAL_LISTING, bodyText: "" };
    const result = normalizeFixture(raw);
    expect(result.hasElevator).toBeUndefined();
    expect(result.hasParking).toBeUndefined();
    expect(result.hasStorage).toBeUndefined();
  });

  it("passes the caller-supplied transaction/property type through untouched", () => {
    const result = normalizeFixture(REAL_LISTING);
    expect(result.transactionType).toBe("rent");
    expect(result.propertyType).toBe("apartment");
  });

  it("leaves price unset (not zero, not a guess) when the price text is unparseable", () => {
    const raw = { ...REAL_LISTING, infoRows: { ...REAL_LISTING.infoRows, ودیعه: "توافقی" } };
    const result = normalizeFixture(raw);
    expect(result.priceToman).toBeUndefined();
  });

  it("leaves building age unset for a construction year that would imply a negative age", () => {
    const raw = { ...REAL_LISTING, groupRow: { headers: ["ساخت"], values: ["۱۴۹۰"] } };
    const result = normalizeFixture(raw);
    expect(result.buildingAgeYears).toBeUndefined();
  });

  it("leaves every optional field unset for a page with no structured data at all", () => {
    const raw: RawDivarDetailPage = {
      requestedUrl: "https://divar.ir/v/gaSebQzv",
      canonicalUrl: null,
      title: null,
      jsonLdDescription: null,
      infoRows: {},
      groupRow: null,
      bodyText: "",
    };
    const result = normalizeFixture(raw);
    expect(result.title).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.priceToman).toBeUndefined();
    expect(result.areaSqm).toBeUndefined();
    expect(result.rooms).toBeUndefined();
    expect(result.floor).toBeUndefined();
    expect(result.buildingAgeYears).toBeUndefined();
  });
});
