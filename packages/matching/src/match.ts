/**
 * The public entry point: `score(listing, profile) -> MatchResult` (MASTER_PROMPT §3, §22).
 *
 * Pure and synchronous. Reads only its two arguments, never mutates them, never touches the
 * clock, network, database, or an LLM. Calling it twice with the same inputs always produces
 * a deeply-equal result (MASTER_PROMPT §20).
 */

import { evaluateArea } from "./area.js";
import { evaluateAttribute } from "./attribute.js";
import { evaluateBudget } from "./budget.js";
import { evaluateBuildingAge } from "./building-age.js";
import { evaluateFloor } from "./floor.js";
import { evaluateDistrict, evaluateNeighborhood } from "./location.js";
import { evaluateRooms } from "./rooms.js";
import { calculateScore } from "./score.js";
import { classifyTier } from "./tier.js";
import type {
  MatchCriterion,
  MatchListingSnapshot,
  MatchProfileSnapshot,
  MatchResult,
  MatchViolation,
} from "./types.js";

export function score(listing: MatchListingSnapshot, profile: MatchProfileSnapshot): MatchResult {
  const criteria: MatchCriterion[] = [];
  const violations: MatchViolation[] = [];

  const push = (evaluation: {
    criterion: MatchCriterion;
    violation: MatchViolation | null;
  }): void => {
    criteria.push(evaluation.criterion);
    if (evaluation.violation !== null) violations.push(evaluation.violation);
  };

  push(evaluateBudget(profile.minPriceToman, profile.maxPriceToman, listing.priceToman));
  push(evaluateArea(profile.minAreaSqm, profile.maxAreaSqm, listing.areaSqm));
  push(evaluateRooms(profile.minRooms, profile.maxRooms, listing.rooms));
  push(evaluateFloor(profile.minFloor, profile.maxFloor, listing.floor, listing.floorCategory));
  push(
    evaluateBuildingAge(
      profile.minBuildingAgeYears,
      profile.maxBuildingAgeYears,
      listing.buildingAgeYears,
    ),
  );
  push(evaluateAttribute("parking", "parking", profile.requireParking, listing.hasParking));
  push(evaluateAttribute("elevator", "elevator", profile.requireElevator, listing.hasElevator));
  push(evaluateAttribute("storage", "storage", profile.requireStorage, listing.hasStorage));
  push(evaluateDistrict(profile.districtGeoAreaId, listing.districtGeoAreaId));
  push(evaluateNeighborhood(profile.neighborhoodGeoAreaId, listing.neighborhoodGeoAreaId));

  const hasHardViolation = violations.some((v) => v.severity === "hard");
  const tier = classifyTier(hasHardViolation, criteria);
  const total = calculateScore(violations, criteria);

  return { total, tier, criteria, violations };
}
