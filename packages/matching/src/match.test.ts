import { describe, expect, it } from "vitest";

import { score } from "./match.js";
import type { MatchListingSnapshot, MatchProfileSnapshot } from "./types.js";

function emptyListing(overrides: Partial<MatchListingSnapshot> = {}): MatchListingSnapshot {
  return {
    priceToman: null,
    areaSqm: null,
    rooms: null,
    floor: null,
    floorCategory: null,
    totalFloors: null,
    buildingAgeYears: null,
    hasParking: null,
    hasElevator: null,
    hasStorage: null,
    districtGeoAreaId: null,
    neighborhoodGeoAreaId: null,
    ...overrides,
  };
}

/** `JSON.stringify` throws on `bigint`; used only to snapshot-compare a purity check. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key: string, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

function emptyProfile(overrides: Partial<MatchProfileSnapshot> = {}): MatchProfileSnapshot {
  return {
    minPriceToman: null,
    maxPriceToman: null,
    minAreaSqm: null,
    maxAreaSqm: null,
    minRooms: null,
    maxRooms: null,
    minFloor: null,
    maxFloor: null,
    minBuildingAgeYears: null,
    maxBuildingAgeYears: null,
    requireParking: null,
    requireElevator: null,
    requireStorage: null,
    districtGeoAreaId: null,
    neighborhoodGeoAreaId: null,
    ...overrides,
  };
}

describe("score", () => {
  describe("mixed profiles", () => {
    it("all criteria matching → exact, score 100", () => {
      const listing = emptyListing({
        priceToman: 5_000_000_000n,
        areaSqm: 125,
        rooms: 2,
        hasParking: true,
        hasElevator: true,
        districtGeoAreaId: "d1",
        neighborhoodGeoAreaId: "n1",
      });
      const profile = emptyProfile({
        maxPriceToman: 6_000_000_000n,
        minAreaSqm: 100,
        minRooms: 2,
        maxRooms: 2,
        requireParking: true,
        requireElevator: true,
        districtGeoAreaId: "d1",
        neighborhoodGeoAreaId: "n1",
      });

      const result = score(listing, profile);

      expect(result.tier).toBe("exact");
      expect(result.total).toBe(100);
      expect(result.violations).toEqual([]);
    });

    it("an entirely unconstrained profile is exact — nothing was requested, nothing was violated", () => {
      const result = score(emptyListing(), emptyProfile());
      expect(result.tier).toBe("exact");
      expect(result.total).toBe(100);
      expect(result.violations).toEqual([]);
      expect(result.criteria.every((c) => c.status === "not_applicable")).toBe(true);
    });

    it("multiple soft mismatches → near, no violations block it, but tier reflects deviation", () => {
      const listing = emptyListing({ floor: 8, buildingAgeYears: 20 });
      const profile = emptyProfile({ maxFloor: 3, maxBuildingAgeYears: 5 });

      const result = score(listing, profile);

      expect(result.violations.every((v) => v.severity === "soft")).toBe(true);
      expect(result.tier).toBe("near");
      expect(result.total).toBeLessThan(100);
    });

    it("one hard violation among otherwise-perfect criteria → near, never exact/strong", () => {
      const listing = emptyListing({
        priceToman: 7_000_000_000n,
        areaSqm: 125,
        rooms: 2,
        hasParking: true,
      });
      const profile = emptyProfile({
        maxPriceToman: 6_000_000_000n,
        minAreaSqm: 100,
        minRooms: 2,
        maxRooms: 2,
        requireParking: true,
      });

      const result = score(listing, profile);

      expect(result.tier).toBe("near");
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toMatchObject({ key: "budget", severity: "hard" });
    });

    it("multiple hard violations still classify as near, all recorded explicitly", () => {
      const listing = emptyListing({ priceToman: 8_000_000_000n, rooms: 1, hasParking: false });
      const profile = emptyProfile({
        maxPriceToman: 6_000_000_000n,
        minRooms: 3,
        maxRooms: 3,
        requireParking: true,
      });

      const result = score(listing, profile);

      expect(result.tier).toBe("near");
      const hardKeys = result.violations.filter((v) => v.severity === "hard").map((v) => v.key);
      expect(hardKeys.sort()).toEqual(["budget", "parking", "rooms"]);
    });

    it("multiple unknowns → strong or near depending on count, never exact", () => {
      const listing = emptyListing(); // everything unknown
      const profile = emptyProfile({
        maxPriceToman: 6_000_000_000n,
        minAreaSqm: 100,
        minRooms: 2,
        maxRooms: 2,
      });

      const result = score(listing, profile);

      expect(result.tier).not.toBe("exact");
      expect(result.violations).toEqual([]); // unknowns are never violations
    });

    it("a partially specified profile only evaluates the stated fields", () => {
      const listing = emptyListing({ areaSqm: 50 }); // would violate an area constraint if one existed
      const profile = emptyProfile({ minRooms: 2, maxRooms: 2 }); // no area constraint at all

      const result = score(listing, profile);

      const areaCriterion = result.criteria.find((c) => c.key === "area");
      expect(areaCriterion?.status).toBe("not_applicable");
    });
  });

  describe("adversarial cases (dangerous real-estate mistakes)", () => {
    it("area 120 against a minimum of 100 must not fail", () => {
      const result = score(emptyListing({ areaSqm: 120 }), emptyProfile({ minAreaSqm: 100 }));
      const areaCriterion = result.criteria.find((c) => c.key === "area");
      expect(areaCriterion?.status).toBe("matched");
      expect(result.violations.some((v) => v.key === "area")).toBe(false);
    });

    it("price 5B against a max of 6B must not fail", () => {
      const result = score(
        emptyListing({ priceToman: 5_000_000_000n }),
        emptyProfile({ maxPriceToman: 6_000_000_000n }),
      );
      expect(result.violations.some((v) => v.key === "budget")).toBe(false);
    });

    it("unknown parking against a required parking preference must never become parking=false", () => {
      const result = score(
        emptyListing({ hasParking: null }),
        emptyProfile({ requireParking: true }),
      );
      const parkingCriterion = result.criteria.find((c) => c.key === "parking");
      expect(parkingCriterion?.status).toBe("unknown");
      expect(parkingCriterion?.actual).toBeUndefined();
      expect(result.violations.some((v) => v.key === "parking")).toBe(false);
    });

    it("2 bedrooms against a requested 3 must not accidentally pass because area/price are excellent", () => {
      const listing = emptyListing({
        rooms: 2,
        areaSqm: 200, // excellent area
        priceToman: 1_000_000_000n, // excellent price
      });
      const profile = emptyProfile({
        minRooms: 3,
        maxRooms: 3,
        minAreaSqm: 50,
        maxPriceToman: 10_000_000_000n,
      });

      const result = score(listing, profile);

      expect(result.tier).not.toBe("exact");
      expect(result.tier).not.toBe("strong");
      expect(result.violations.some((v) => v.key === "rooms" && v.severity === "hard")).toBe(true);
    });

    it("district 2 against a requested district 5 must never become exact", () => {
      const result = score(
        emptyListing({ districtGeoAreaId: "district-2" }),
        emptyProfile({ districtGeoAreaId: "district-5" }),
      );
      expect(result.tier).not.toBe("exact");
      expect(result.tier).not.toBe("strong");
    });

    it("unknown price against a max budget must not become a confirmed violation", () => {
      const result = score(
        emptyListing({ priceToman: null }),
        emptyProfile({ maxPriceToman: 6_000_000_000n }),
      );
      expect(result.violations.some((v) => v.key === "budget")).toBe(false);
      const budgetCriterion = result.criteria.find((c) => c.key === "budget");
      expect(budgetCriterion?.status).toBe("unknown");
    });

    it("a required-false parking preference is violated by a listing that has parking", () => {
      const result = score(
        emptyListing({ hasParking: true }),
        emptyProfile({ requireParking: false }),
      );
      expect(result.violations.some((v) => v.key === "parking" && v.severity === "hard")).toBe(
        true,
      );
    });

    it("همکف (ground floor) against a numeric floor range is unknown, never floor 0", () => {
      const result = score(
        emptyListing({ floor: null, floorCategory: "ground" }),
        emptyProfile({ minFloor: 2 }),
      );
      const floorCriterion = result.criteria.find((c) => c.key === "floor");
      expect(floorCriterion?.status).toBe("unknown");
      expect(result.violations.some((v) => v.key === "floor")).toBe(false);
    });
  });

  describe("monotonicity and safety properties", () => {
    it("determinism: repeated calls with identical inputs produce deeply equal results", () => {
      const listing = emptyListing({ priceToman: 5_000_000_000n, areaSqm: 120, rooms: 2 });
      const profile = emptyProfile({ maxPriceToman: 6_000_000_000n, minAreaSqm: 100, minRooms: 2 });

      const first = score(listing, profile);
      const second = score(listing, profile);
      const third = score(listing, profile);

      expect(second).toEqual(first);
      expect(third).toEqual(first);
    });

    it("purity: inputs are not mutated by scoring", () => {
      const listing = emptyListing({ priceToman: 5_000_000_000n, areaSqm: 120 });
      const profile = emptyProfile({ maxPriceToman: 6_000_000_000n, minAreaSqm: 100 });
      const listingSnapshot = stableStringify(listing);
      const profileSnapshot = stableStringify(profile);

      score(listing, profile);

      expect(stableStringify(listing)).toBe(listingSnapshot);
      expect(stableStringify(profile)).toBe(profileSnapshot);
    });

    it("bounded score: total is always within [0, 100] across many random-ish combinations", () => {
      const priceOptions = [null, 1_000_000_000n, 6_000_000_000n, 20_000_000_000n];
      const areaOptions = [null, 50, 100, 300];
      const roomOptions = [null, 1, 2, 5];

      for (const priceToman of priceOptions) {
        for (const areaSqm of areaOptions) {
          for (const rooms of roomOptions) {
            const result = score(
              emptyListing({ priceToman, areaSqm, rooms }),
              emptyProfile({
                maxPriceToman: 6_000_000_000n,
                minAreaSqm: 100,
                minRooms: 2,
                maxRooms: 2,
              }),
            );
            expect(result.total).toBeGreaterThanOrEqual(0);
            expect(result.total).toBeLessThanOrEqual(100);
            expect(Number.isInteger(result.total)).toBe(true);
          }
        }
      }
    });

    it("tier consistency: identical inputs always produce the same tier", () => {
      const listing = emptyListing({ priceToman: 7_000_000_000n });
      const profile = emptyProfile({ maxPriceToman: 6_000_000_000n });
      const tiers = new Set(Array.from({ length: 5 }, () => score(listing, profile).tier));
      expect(tiers.size).toBe(1);
    });

    it("unknown safety: replacing a matching value with unknown never turns it into a violation", () => {
      const profile = emptyProfile({ requireParking: true });
      const known = score(emptyListing({ hasParking: true }), profile);
      const unknown = score(emptyListing({ hasParking: null }), profile);

      expect(known.violations).toEqual([]);
      expect(unknown.violations).toEqual([]);
      expect(unknown.criteria.find((c) => c.key === "parking")?.status).toBe("unknown");
    });

    it("no false positives: changing an unrelated field does not affect an unrelated criterion", () => {
      const profile = emptyProfile({ maxPriceToman: 6_000_000_000n });
      const a = score(emptyListing({ priceToman: 5_000_000_000n, rooms: 2 }), profile);
      const b = score(emptyListing({ priceToman: 5_000_000_000n, rooms: 5 }), profile);

      const budgetA = a.criteria.find((c) => c.key === "budget");
      const budgetB = b.criteria.find((c) => c.key === "budget");
      expect(budgetA).toEqual(budgetB);
    });

    it("explainability: every hard violation has a corresponding mismatch criterion with the same key", () => {
      const listing = emptyListing({
        priceToman: 8_000_000_000n,
        rooms: 1,
        hasParking: false,
        districtGeoAreaId: "wrong-district",
      });
      const profile = emptyProfile({
        maxPriceToman: 6_000_000_000n,
        minRooms: 3,
        maxRooms: 3,
        requireParking: true,
        districtGeoAreaId: "right-district",
      });

      const result = score(listing, profile);
      const hardViolationKeys = result.violations
        .filter((v) => v.severity === "hard")
        .map((v) => v.key);

      for (const key of hardViolationKeys) {
        const matchingCriterion = result.criteria.find((c) => c.key === key);
        expect(matchingCriterion?.status).toBe("mismatch");
      }
    });
  });

  describe("tier classification", () => {
    it("exact requires zero deviation", () => {
      const listing = emptyListing({ priceToman: 5_000_000_000n });
      const profile = emptyProfile({ maxPriceToman: 6_000_000_000n });
      expect(score(listing, profile).tier).toBe("exact");
    });

    it("strong allows limited uncertainty with no violation", () => {
      const listing = emptyListing({ priceToman: 5_000_000_000n, rooms: null });
      const profile = emptyProfile({ maxPriceToman: 6_000_000_000n, minRooms: 2, maxRooms: 2 });
      expect(score(listing, profile).tier).toBe("strong");
    });

    it("near reflects meaningful deviation", () => {
      const listing = emptyListing({ rooms: null, floor: null, buildingAgeYears: null });
      const profile = emptyProfile({
        minRooms: 2,
        maxRooms: 2,
        maxFloor: 5,
        maxBuildingAgeYears: 10,
      });
      expect(score(listing, profile).tier).toBe("near");
    });
  });
});
