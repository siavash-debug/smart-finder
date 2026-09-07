/**
 * Location matching — MASTER_PROMPT §17. Compares canonical `geo_area` ids, never raw
 * Persian strings; that resolution already happened upstream (Phase 1 `source_area_alias` /
 * `@smart-finder/normalizer`'s `resolveGeoArea`). No distance calculation — Phase 3 is the
 * deterministic matching layer, not the map engine, and the schema has no coordinates wired
 * up for this yet.
 *
 * District and neighborhood are evaluated as two separate criteria, deliberately: district is
 * hard (MASTER_PROMPT §6's own example lists `district_required`), while neighborhood is soft
 * — a listing in the right district but the wrong neighborhood should still pass the hard
 * gate, just score and explain lower than an exact neighborhood match (§17: "a listing in the
 * exact requested neighborhood should score better than merely being in the same district").
 */

import type { MatchCriterion, MatchViolation } from "./types.js";

export interface LocationEvaluation {
  criterion: MatchCriterion;
  violation: MatchViolation | null;
}

export function evaluateDistrict(
  requestedDistrictId: string | null,
  actualDistrictId: string | null,
): LocationEvaluation {
  if (requestedDistrictId === null) {
    return {
      criterion: {
        key: "district",
        status: "not_applicable",
        explanation: "No district preference was stated.",
      },
      violation: null,
    };
  }

  if (actualDistrictId === null) {
    return {
      criterion: {
        key: "district",
        status: "unknown",
        requested: requestedDistrictId,
        explanation: "District is unknown for this listing.",
      },
      violation: null,
    };
  }

  if (actualDistrictId === requestedDistrictId) {
    return {
      criterion: {
        key: "district",
        status: "matched",
        requested: requestedDistrictId,
        actual: actualDistrictId,
        explanation: "Listing is in the requested district.",
      },
      violation: null,
    };
  }

  const violation: MatchViolation = {
    key: "district",
    severity: "hard",
    requested: requestedDistrictId,
    actual: actualDistrictId,
    reason: "Listing is not in the requested district.",
  };
  return {
    criterion: {
      key: "district",
      status: "mismatch",
      requested: requestedDistrictId,
      actual: actualDistrictId,
      explanation: violation.reason,
    },
    violation,
  };
}

export function evaluateNeighborhood(
  requestedNeighborhoodId: string | null,
  actualNeighborhoodId: string | null,
): LocationEvaluation {
  if (requestedNeighborhoodId === null) {
    return {
      criterion: {
        key: "neighborhood",
        status: "not_applicable",
        explanation: "No neighborhood preference was stated.",
      },
      violation: null,
    };
  }

  if (actualNeighborhoodId === null) {
    return {
      criterion: {
        key: "neighborhood",
        status: "unknown",
        requested: requestedNeighborhoodId,
        explanation: "Neighborhood is unknown for this listing.",
      },
      violation: null,
    };
  }

  if (actualNeighborhoodId === requestedNeighborhoodId) {
    return {
      criterion: {
        key: "neighborhood",
        status: "matched",
        requested: requestedNeighborhoodId,
        actual: actualNeighborhoodId,
        explanation: "Listing is in the requested neighborhood.",
      },
      violation: null,
    };
  }

  const violation: MatchViolation = {
    key: "neighborhood",
    severity: "soft",
    requested: requestedNeighborhoodId,
    actual: actualNeighborhoodId,
    reason: "Listing is not in the requested neighborhood.",
  };
  return {
    criterion: {
      key: "neighborhood",
      status: "mismatch",
      requested: requestedNeighborhoodId,
      actual: actualNeighborhoodId,
      explanation: violation.reason,
    },
    violation,
  };
}
