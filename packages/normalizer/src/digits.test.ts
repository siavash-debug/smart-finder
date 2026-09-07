import { describe, expect, it } from "vitest";

import {
  normalizeDigits,
  parseDecimalLiteral,
  parseInteger,
  scaleDecimalToBigInt,
} from "./digits.js";

describe("normalizeDigits", () => {
  it("converts Persian digits to Latin", () => {
    expect(normalizeDigits("۱۲۵")).toBe("125");
  });

  it("converts Arabic-Indic digits to Latin", () => {
    expect(normalizeDigits("١٢٥")).toBe("125");
  });

  it("leaves Latin digits unchanged", () => {
    expect(normalizeDigits("125")).toBe("125");
  });

  it("handles mixed scripts in one string", () => {
    expect(normalizeDigits("۱2٥")).toBe("125");
  });

  it("leaves non-digit characters untouched", () => {
    expect(normalizeDigits("۱,۲۵۰ متر")).toBe("1,250 متر");
  });

  it("is idempotent", () => {
    const once = normalizeDigits("۱۲۵");
    expect(normalizeDigits(once)).toBe(once);
  });
});

describe("parseDecimalLiteral", () => {
  it("parses a plain Persian-digit integer", () => {
    expect(parseDecimalLiteral("۱۲۵")).toEqual({ integer: 125n, fraction: 0n, fractionDigits: 0 });
  });

  it("parses a plain Arabic-Indic integer", () => {
    expect(parseDecimalLiteral("١٢٥")).toEqual({ integer: 125n, fraction: 0n, fractionDigits: 0 });
  });

  it("parses a plain Latin integer", () => {
    expect(parseDecimalLiteral("125")).toEqual({ integer: 125n, fraction: 0n, fractionDigits: 0 });
  });

  it("parses a correctly comma-grouped integer", () => {
    expect(parseDecimalLiteral("۱,۲۵۰")).toEqual({
      integer: 1250n,
      fraction: 0n,
      fractionDigits: 0,
    });
    expect(parseDecimalLiteral("5,000,000,000")).toEqual({
      integer: 5_000_000_000n,
      fraction: 0n,
      fractionDigits: 0,
    });
  });

  it("parses a decimal value", () => {
    expect(parseDecimalLiteral("۵.۲")).toEqual({ integer: 5n, fraction: 2n, fractionDigits: 1 });
    expect(parseDecimalLiteral("5.25")).toEqual({ integer: 5n, fraction: 25n, fractionDigits: 2 });
  });

  it("accepts the Arabic decimal separator", () => {
    expect(parseDecimalLiteral("۵٫۲")).toEqual({ integer: 5n, fraction: 2n, fractionDigits: 1 });
  });

  it("preserves a leading-zero fraction (5.05 is not 5.5)", () => {
    expect(parseDecimalLiteral("5.05")).toEqual({ integer: 5n, fraction: 5n, fractionDigits: 2 });
  });

  it("rejects an incorrectly grouped integer", () => {
    expect(parseDecimalLiteral("12,5")).toBeNull();
    expect(parseDecimalLiteral("1,2345")).toBeNull();
    expect(parseDecimalLiteral("1234,567")).toBeNull();
  });

  it("rejects more than one decimal point", () => {
    expect(parseDecimalLiteral("5.2.3")).toBeNull();
  });

  it("rejects a trailing decimal point", () => {
    expect(parseDecimalLiteral("5.")).toBeNull();
  });

  it("rejects a leading decimal point", () => {
    expect(parseDecimalLiteral(".5")).toBeNull();
  });

  it("rejects empty or whitespace-only input", () => {
    expect(parseDecimalLiteral("")).toBeNull();
    expect(parseDecimalLiteral("   ")).toBeNull();
  });

  it("rejects non-numeric text", () => {
    expect(parseDecimalLiteral("متر")).toBeNull();
    expect(parseDecimalLiteral("۱۲۵ متر")).toBeNull(); // trailing garbage, not stripped
  });

  it("rejects a negative sign rather than interpreting it", () => {
    expect(parseDecimalLiteral("-125")).toBeNull();
  });
});

describe("parseInteger", () => {
  it("parses digits and grouped digits", () => {
    expect(parseInteger("۱۲۵")).toBe(125);
    expect(parseInteger("1,250")).toBe(1250);
  });

  it("rejects a decimal value", () => {
    expect(parseInteger("125.5")).toBeNull();
  });

  it("rejects malformed input rather than truncating it", () => {
    expect(parseInteger("125m")).toBeNull();
    expect(parseInteger("")).toBeNull();
  });
});

describe("scaleDecimalToBigInt", () => {
  it("scales an integer exactly", () => {
    const literal = parseDecimalLiteral("5")!;
    expect(scaleDecimalToBigInt(literal, 1_000_000_000n)).toBe(5_000_000_000n);
  });

  it("scales a decimal exactly when the result is a whole number", () => {
    const literal = parseDecimalLiteral("5.2")!;
    expect(scaleDecimalToBigInt(literal, 1_000_000_000n)).toBe(5_200_000_000n);
  });

  it("scales a two-digit decimal exactly", () => {
    const literal = parseDecimalLiteral("3.25")!;
    expect(scaleDecimalToBigInt(literal, 1_000_000n)).toBe(3_250_000n);
  });

  it("rejects a decimal that would produce a fractional result at this scale", () => {
    // 5.1234567 * 1_000_000 = 5,123,456.7 — not an integer Toman amount.
    const literal = parseDecimalLiteral("5.1234567")!;
    expect(scaleDecimalToBigInt(literal, 1_000_000n)).toBeNull();
  });

  it("never uses floating-point arithmetic (exact for values a float would round)", () => {
    // 0.1 cannot be represented exactly in IEEE-754; a float-based implementation would drift.
    const literal = parseDecimalLiteral("0.1")!;
    expect(scaleDecimalToBigInt(literal, 1_000_000_000n)).toBe(100_000_000n);
  });
});
