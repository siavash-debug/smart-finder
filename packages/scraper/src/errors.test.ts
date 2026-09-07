import { describe, expect, it } from "vitest";

import { HARD_STOP_CATEGORIES, IngestionError, type IngestionErrorCategory } from "./errors.js";

describe("IngestionError", () => {
  it("marks ACCESS_DENIED and CAPTCHA as hard stops", () => {
    expect(new IngestionError("ACCESS_DENIED", "denied").isHardStop).toBe(true);
    expect(new IngestionError("CAPTCHA", "captcha").isHardStop).toBe(true);
  });

  it("does not mark ordinary failures as hard stops", () => {
    const nonHardStop: IngestionErrorCategory[] = [
      "NAVIGATION_TIMEOUT",
      "SELECTOR_MISSING",
      "PARSE_ERROR",
      "NORMALIZATION_ERROR",
      "PERSISTENCE_ERROR",
      "BROWSER_ERROR",
      "UNKNOWN_ERROR",
    ];
    for (const category of nonHardStop) {
      expect(new IngestionError(category, "x").isHardStop).toBe(false);
    }
  });

  it("HARD_STOP_CATEGORIES contains exactly the two compliance-mandated categories", () => {
    expect([...HARD_STOP_CATEGORIES].sort()).toEqual(["ACCESS_DENIED", "CAPTCHA"]);
  });

  it("carries the url and cause through for diagnostics", () => {
    const cause = new Error("boom");
    const error = new IngestionError("BROWSER_ERROR", "failed", {
      url: "https://divar.ir/v/x",
      cause,
    });
    expect(error.url).toBe("https://divar.ir/v/x");
    expect(error.cause).toBe(cause);
  });
});
