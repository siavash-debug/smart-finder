import { describe, expect, it } from "vitest";

import { computeContentHash } from "./content-hash.js";
import type { NormalizedListingFields } from "./types.js";

const BASE: NormalizedListingFields = {
  transactionType: "rent",
  propertyType: "apartment",
  title: "۱۱۰ متر",
  priceToman: 4_100_000_000n,
  areaSqm: 110,
  rooms: 2,
  floor: 3,
  totalFloors: 5,
  hasElevator: true,
  hasParking: true,
  hasStorage: false,
};

describe("computeContentHash", () => {
  it("is deterministic for identical content", () => {
    expect(computeContentHash(BASE)).toBe(computeContentHash({ ...BASE }));
  });

  it("changes when the price changes", () => {
    expect(computeContentHash(BASE)).not.toBe(
      computeContentHash({ ...BASE, priceToman: 4_500_000_000n }),
    );
  });

  it("is stable across different key insertion order (bigint and all)", () => {
    const reordered: NormalizedListingFields = {
      hasStorage: false,
      hasParking: true,
      hasElevator: true,
      totalFloors: 5,
      floor: 3,
      rooms: 2,
      areaSqm: 110,
      priceToman: 4_100_000_000n,
      title: "۱۱۰ متر",
      propertyType: "apartment",
      transactionType: "rent",
    };
    expect(computeContentHash(BASE)).toBe(computeContentHash(reordered));
  });

  it("distinguishes an unset field from an explicitly-false one", () => {
    const { hasStorage: _hasStorage, ...withoutStorage } = BASE;
    expect(computeContentHash(withoutStorage)).not.toBe(computeContentHash(BASE));
  });

  it("does not depend on non-content fields like collectionRunId (they aren't part of this type)", () => {
    // NormalizedListingFields has no identity/bookkeeping fields at all — this is really just
    // documenting the invariant that content-hash inputs and posting identity are disjoint.
    expect(computeContentHash(BASE)).toHaveLength(64); // sha256 hex digest length
  });
});
