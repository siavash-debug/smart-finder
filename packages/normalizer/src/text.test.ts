import { describe, expect, it } from "vitest";

import { normalizeText } from "./text.js";

describe("normalizeText", () => {
  it("folds Arabic Yeh and Alef Maksura to Persian Yeh", () => {
    expect(normalizeText("علي")).toBe("علی");
    expect(normalizeText("مصطفى")).toBe("مصطفی");
  });

  it("folds Arabic Kaf to Persian Keheh", () => {
    expect(normalizeText("كوچك")).toBe("کوچک");
  });

  it("collapses plain ASCII whitespace runs to one space", () => {
    expect(normalizeText("متر   دو")).toBe("متر دو");
  });

  it("collapses a non-breaking space to a plain space", () => {
    // U+00A0 between the words, built without pasting an invisible character into this file.
    const nbsp = String.fromCharCode(0x00a0);
    expect(normalizeText(`متر${nbsp}دو`)).toBe("متر دو");
  });

  it("still matches a plain ASCII space as whitespace", () => {
    expect(normalizeText("a b")).toBe("a b");
    expect(normalizeText("a    b")).toBe("a b");
  });

  it("strips zero-width non-joiner without merging distinct words", () => {
    const zwnj = String.fromCharCode(0x200c);
    // "می‌خواهم" (I want) — the ZWNJ sits inside one word; stripping it must not touch the
    // space that separates it from the next word.
    const input = `می${zwnj}خواهم خانه`;
    expect(normalizeText(input)).toBe("میخواهم خانه");
  });

  it("strips a leading byte-order mark", () => {
    const bom = String.fromCharCode(0xfeff);
    expect(normalizeText(`${bom}سلام`)).toBe("سلام");
  });

  it("strips right-to-left and left-to-right marks (real Divar price text, ADR-0016)", () => {
    const rlm = String.fromCharCode(0x200f);
    const lrm = String.fromCharCode(0x200e);
    expect(normalizeText(`${rlm}۴,۱۰۰,۰۰۰,۰۰۰ تومان`)).toBe("۴,۱۰۰,۰۰۰,۰۰۰ تومان");
    expect(normalizeText(`${lrm}test`)).toBe("test");
  });

  it("strips combining Arabic diacritics so اجارهٔ and اجاره normalize identically (real Divar label variation)", () => {
    const withHamza = "اجارهٔ ماهانه"; // اجارهٔ ماهانه — combining hamza above (U+0654)
    expect(normalizeText(withHamza)).toBe(normalizeText("اجاره ماهانه"));
    expect(normalizeText(withHamza)).toBe("اجاره ماهانه");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeText("  سلام  ")).toBe("سلام");
  });

  it("normalizes the Arabic comma and dash width variants to ASCII equivalents", () => {
    expect(normalizeText("۱۲۵ متر، دو خواب")).toBe("۱۲۵ متر, دو خواب");
    // U+2013 EN DASH
    const enDash = String.fromCharCode(0x2013);
    expect(normalizeText(`۵${enDash}۶ میلیارد`)).toBe("۵-۶ میلیارد");
  });

  it("leaves digits untouched — normalizeDigits owns that", () => {
    expect(normalizeText("۱۲۵ متر")).toBe("۱۲۵ متر");
    expect(normalizeText("125 متر")).toBe("125 متر");
  });

  it("does not destroy meaningful text — round-trips ordinary Persian sentences", () => {
    const input = "یک آپارتمان دو خوابه در سعادت‌آباد با پارکینگ و آسانسور";
    const normalized = normalizeText(input);
    expect(normalized).toContain("آپارتمان");
    expect(normalized).toContain("پارکینگ");
    expect(normalized).toContain("آسانسور");
  });

  describe("idempotency", () => {
    const samples = [
      "علي كوچك",
      "۱۲۵ متر، دو خواب",
      "  سلام   دنیا  ",
      "می‌خواهم خانه‌ای در شمال تهران",
      "a b\tc\nd",
      "",
      "   ",
    ];

    it.each(samples)("normalizeText(normalizeText(%j)) === normalizeText(%j)", (sample) => {
      const once = normalizeText(sample);
      const twice = normalizeText(once);
      expect(twice).toBe(once);
    });

    it("holds for strings containing zero-width and non-breaking characters", () => {
      const zwnj = String.fromCharCode(0x200c);
      const nbsp = String.fromCharCode(0x00a0);
      const sample = `می${zwnj}خواهم${nbsp}خانه`;
      const once = normalizeText(sample);
      expect(normalizeText(once)).toBe(once);
    });
  });
});
