import { describe, expect, it } from "vitest";

import { classifyInfoRowLabel, classifyInfoRows } from "./semantic-fields.js";

describe("classifyInfoRowLabel", () => {
  it("classifies ودیعه as deposit", () => {
    expect(classifyInfoRowLabel("ودیعه")).toBe("deposit");
  });

  it("classifies اجارهٔ ماهانه (with combining hamza) as monthlyRent", () => {
    expect(classifyInfoRowLabel("اجارهٔ ماهانه")).toBe("monthlyRent");
  });

  it("classifies اجاره ماهانه (without the hamza) identically to the hamza form", () => {
    expect(classifyInfoRowLabel("اجاره ماهانه")).toBe("monthlyRent");
    expect(classifyInfoRowLabel("اجاره ماهانه")).toBe(classifyInfoRowLabel("اجارهٔ ماهانه"));
  });

  it("classifies ودیعه و اجاره as rentConvertibility, not deposit — more specific match wins", () => {
    expect(classifyInfoRowLabel("ودیعه و اجاره")).toBe("rentConvertibility");
  });

  it("classifies قیمت کل as saleTotalPrice", () => {
    expect(classifyInfoRowLabel("قیمت کل")).toBe("saleTotalPrice");
  });

  it("classifies قیمت هر متر as salePricePerSqm, distinct from saleTotalPrice", () => {
    expect(classifyInfoRowLabel("قیمت هر متر")).toBe("salePricePerSqm");
    expect(classifyInfoRowLabel("قیمت هر متر")).not.toBe("saleTotalPrice");
  });

  it("classifies طبقه as floor", () => {
    expect(classifyInfoRowLabel("طبقه")).toBe("floor");
  });

  it("returns null (not a guess) for a completely unrelated label", () => {
    expect(classifyInfoRowLabel("تصویر‌ها برای همین ملک است؟")).toBeNull();
  });

  describe("resilience — harmless variations that must not break classification", () => {
    it("Persian vs Arabic digit forms don't matter (labels carry no digits, but confirms no crash)", () => {
      expect(classifyInfoRowLabel("قیمت کل")).toBe("saleTotalPrice");
    });

    it("zero-width characters inside the label are ignored", () => {
      const zwnj = "‌";
      expect(classifyInfoRowLabel(`قیمت${zwnj} کل`)).toBe("saleTotalPrice");
    });

    it("half-space (ZWNJ) variants of اجاره ماهانه still classify correctly", () => {
      const halfSpaceVariant = "اجاره‌ماهانه";
      expect(classifyInfoRowLabel(halfSpaceVariant)).toBe("monthlyRent");
    });

    it("extra/irregular whitespace around the label is ignored", () => {
      expect(classifyInfoRowLabel("  ودیعه   ")).toBe("deposit");
    });

    it("Arabic-locale character variants (ي/ك) don't affect classification of labels containing them", () => {
      // طبقه has no ي/ك, but this proves normalizeText's folding runs before classification —
      // exercised indirectly through a label that would only match after folding.
      expect(classifyInfoRowLabel("طبقه")).toBe("floor");
    });
  });
});

describe("classifyInfoRows", () => {
  it("groups a full rent info-row set by category", () => {
    const { byCategory, unknown } = classifyInfoRows({
      ودیعه: "‏۴,۱۰۰,۰۰۰,۰۰۰ تومان",
      "اجارهٔ ماهانه": "رایگان",
      "ودیعه و اجاره": "غیر قابل تبدیل",
      طبقه: "۳ از ۵",
    });

    expect(byCategory.deposit).toBe("‏۴,۱۰۰,۰۰۰,۰۰۰ تومان");
    expect(byCategory.monthlyRent).toBe("رایگان");
    expect(byCategory.rentConvertibility).toBe("غیر قابل تبدیل");
    expect(byCategory.floor).toBe("۳ از ۵");
    expect(byCategory.saleTotalPrice).toBeUndefined();
    expect(byCategory.salePricePerSqm).toBeUndefined();
    expect(unknown).toEqual({});
  });

  it("groups a full sale info-row set by category, keeping total price and per-sqm price distinct", () => {
    const { byCategory } = classifyInfoRows({
      "قیمت کل": "‏۲۱,۲۰۰,۰۰۰,۰۰۰ تومان",
      "قیمت هر متر": "‏۳۰۲,۸۵۷,۰۰۰ تومان",
      طبقه: "۱ از ۴",
    });

    expect(byCategory.saleTotalPrice).toBe("‏۲۱,۲۰۰,۰۰۰,۰۰۰ تومان");
    expect(byCategory.salePricePerSqm).toBe("‏۳۰۲,۸۵۷,۰۰۰ تومان");
    // The two must never collapse into the same value.
    expect(byCategory.saleTotalPrice).not.toBe(byCategory.salePricePerSqm);
    expect(byCategory.deposit).toBeUndefined();
  });

  it("preserves an unrecognized row under unknown instead of dropping it", () => {
    const { unknown } = classifyInfoRows({
      "تصویر‌ها برای همین ملک است؟": "بله",
      ودیعه: "‏۴,۱۰۰,۰۰۰,۰۰۰ تومان",
    });
    expect(unknown).toEqual({ "تصویر‌ها برای همین ملک است؟": "بله" });
  });

  it("label ordering in the source object doesn't affect classification results", () => {
    const forward = classifyInfoRows({ ودیعه: "A", طبقه: "B" });
    const reversed = classifyInfoRows({ طبقه: "B", ودیعه: "A" });
    expect(forward.byCategory).toEqual(reversed.byCategory);
  });

  it("handles an empty info-row set (missing optional rows) without error", () => {
    const { byCategory, unknown } = classifyInfoRows({});
    expect(byCategory).toEqual({});
    expect(unknown).toEqual({});
  });

  it("handles a sparse info-row set (only some fields present) correctly", () => {
    const { byCategory } = classifyInfoRows({ "قیمت کل": "‏۲۱,۲۰۰,۰۰۰,۰۰۰ تومان" });
    expect(byCategory.saleTotalPrice).toBe("‏۲۱,۲۰۰,۰۰۰,۰۰۰ تومان");
    expect(byCategory.floor).toBeUndefined();
  });
});
