/**
 * Deterministic content hashing for change detection (Phase 5). `upsertPosting`
 * (`@smart-finder/database`) decides new/unchanged/changed purely from comparing this hash to
 * the stored one, so the hash must depend on exactly the fields that count as "meaningful
 * content" and on nothing else (not a timestamp, not the collection run id).
 */

import { createHash } from "node:crypto";

import type { NormalizedListingFields } from "./types.js";

/** Explicit key order, independent of object insertion order, so the hash never drifts merely
 *  because a field was written in a different order upstream. */
const HASHED_KEYS: readonly (keyof NormalizedListingFields)[] = [
  "transactionType",
  "propertyType",
  "title",
  "description",
  "priceToman",
  "areaSqm",
  "rooms",
  "floor",
  "totalFloors",
  "buildingAgeYears",
  "hasElevator",
  "hasParking",
  "hasStorage",
  "rawAddress",
];

export function computeContentHash(fields: NormalizedListingFields): string {
  const record = HASHED_KEYS.map((key) => {
    const value = fields[key];
    return [key, value === undefined ? null : typeof value === "bigint" ? value.toString() : value];
  });
  const canonical = JSON.stringify(record);
  return createHash("sha256").update(canonical).digest("hex");
}
