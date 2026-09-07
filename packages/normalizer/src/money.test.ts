import { describe, expect, it } from "vitest";

import { parseMoney } from "./money.js";

describe("parseMoney", () => {
  describe("total prices", () => {
    it("parses a digit + billion scale word", () => {
      expect(parseMoney("۵ میلیارد")).toMatchObject({
        kind: "exact",
        amountToman: 5_000_000_000n,
        perSquareMeter: false,
        approximate: false,
      });
    });

    it("parses the Latin-digit equivalent identically", () => {
      expect(parseMoney("5 میلیارد")).toMatchObject({
        kind: "exact",
        amountToman: 5_000_000_000n,
      });
    });

    it("parses an explicit تومان suffix", () => {
      expect(parseMoney("۵ میلیارد تومان")).toMatchObject({
        kind: "exact",
        amountToman: 5_000_000_000n,
      });
    });

    it("parses a fully-grouped bare number with explicit currency", () => {
      expect(parseMoney("۵,۰۰۰,۰۰۰,۰۰۰ تومان")).toMatchObject({
        kind: "exact",
        amountToman: 5_000_000_000n,
      });
    });

    it("parses million scale", () => {
      expect(parseMoney("۳۵۰ میلیون")).toMatchObject({
        kind: "exact",
        amountToman: 350_000_000n,
      });
      expect(parseMoney("350 میلیون تومان")).toMatchObject({
        kind: "exact",
        amountToman: 350_000_000n,
      });
    });

    it("parses a cross-scale compound joined by و", () => {
      expect(parseMoney("۵ میلیارد و ۲۰۰ میلیون")).toMatchObject({
        kind: "exact",
        amountToman: 5_200_000_000n,
      });
    });

    it("parses an exact decimal scale", () => {
      expect(parseMoney("۵.۲ میلیارد")).toMatchObject({
        kind: "exact",
        amountToman: 5_200_000_000n,
      });
    });

    it("parses a pure number-word phrase", () => {
      expect(parseMoney("پنج میلیارد تومان")).toMatchObject({
        kind: "exact",
        amountToman: 5_000_000_000n,
      });
    });

    it("converts an explicit ریال amount to Toman", () => {
      expect(parseMoney("۵۰,۰۰۰,۰۰۰,۰۰۰ ریال")).toMatchObject({
        kind: "exact",
        amountToman: 5_000_000_000n,
      });
    });

    it("rejects a ریال amount that is not a whole Toman", () => {
      expect(parseMoney("۵ ریال")).toEqual({ kind: "unknown", sourceText: "۵ ریال" });
    });
  });

  describe("per-square-meter prices", () => {
    it("recognizes the متری marker", () => {
      expect(parseMoney("متری ۱۲۰ میلیون")).toMatchObject({
        kind: "exact",
        amountToman: 120_000_000n,
        perSquareMeter: true,
      });
    });

    it("does not mark an ordinary total price as per-square-meter", () => {
      expect(parseMoney("۵ میلیارد")).toMatchObject({ perSquareMeter: false });
    });
  });

  describe("approximate amounts", () => {
    it("recognizes حدود and preserves the approximate flag without inventing false precision", () => {
      const result = parseMoney("حدود ۵ میلیارد");
      expect(result).toMatchObject({
        kind: "exact",
        amountToman: 5_000_000_000n,
        approximate: true,
      });
    });

    it("recognizes تقریبا", () => {
      expect(parseMoney("تقریبا ۵ میلیارد")).toMatchObject({ approximate: true });
    });
  });

  describe("ranges", () => {
    it("parses a range sharing one trailing scale word", () => {
      expect(parseMoney("۵ تا ۶ میلیارد")).toMatchObject({
        kind: "range",
        minToman: 5_000_000_000n,
        maxToman: 6_000_000_000n,
      });
    });

    it("parses a range where each side states its own scale", () => {
      expect(parseMoney("۵ میلیارد تا ۶ میلیارد")).toMatchObject({
        kind: "range",
        minToman: 5_000_000_000n,
        maxToman: 6_000_000_000n,
      });
    });

    it("does not conflate a range with a total or per-meter price", () => {
      const result = parseMoney("۵ تا ۶ میلیارد");
      expect(result.kind).toBe("range");
      expect(result).not.toHaveProperty("amountToman");
    });
  });

  describe("ambiguity and malformed input", () => {
    it("returns unknown for a bare number with no currency and no scale word", () => {
      expect(parseMoney("500")).toEqual({ kind: "unknown", sourceText: "500" });
    });

    it("returns unknown for free text with no numeric content", () => {
      expect(parseMoney("قیمت توافقی")).toEqual({ kind: "unknown", sourceText: "قیمت توافقی" });
    });

    it("returns unknown for a malformed grouped number", () => {
      expect(parseMoney("۱۲,۵ میلیارد")).toEqual({ kind: "unknown", sourceText: "۱۲,۵ میلیارد" });
    });

    it("returns unknown for an empty string", () => {
      expect(parseMoney("")).toEqual({ kind: "unknown", sourceText: "" });
    });

    it("rejects a decimal that implies a fractional Toman", () => {
      // 5.1234567 * 1,000,000 is not a whole Toman amount.
      expect(parseMoney("۵.۱۲۳۴۵۶۷ میلیون")).toEqual({
        kind: "unknown",
        sourceText: "۵.۱۲۳۴۵۶۷ میلیون",
      });
    });

    it("rejects a compound where a bare unscaled term is combined with a scaled one", () => {
      expect(parseMoney("۵ و ۲۰۰ میلیون")).toEqual({
        kind: "unknown",
        sourceText: "۵ و ۲۰۰ میلیون",
      });
    });

    it("rejects a range where neither side states a unit", () => {
      expect(parseMoney("۵ تا ۶")).toEqual({ kind: "unknown", sourceText: "۵ تا ۶" });
    });

    it("preserves the original source text verbatim on every result", () => {
      const input = "  ۵ میلیارد  ";
      expect(parseMoney(input).sourceText).toBe(input);
    });

    it("never conflates a total price with a per-square-meter price when unmarked", () => {
      const total = parseMoney("۵ میلیارد");
      const perMeter = parseMoney("متری ۵ میلیارد");
      expect(total).toMatchObject({ perSquareMeter: false });
      expect(perMeter).toMatchObject({ perSquareMeter: true });
    });
  });
});
