import { extractSourcePostingId } from "./url.js";
import type { ParsedDivarFields, RawDivarDetailPage } from "./types.js";

const AREA_LABEL = "متراژ";
const BUILDING_AGE_LABEL = "ساخت";
const ROOMS_LABEL = "اتاق";
const PRICE_LABEL = "ودیعه";
const FLOOR_LABEL = "طبقه";

function fromGroupRow(raw: RawDivarDetailPage, label: string): string | null {
  if (raw.groupRow === null) return null;
  const index = raw.groupRow.headers.indexOf(label);
  if (index === -1) return null;
  return raw.groupRow.values[index] ?? null;
}

function fromInfoRow(raw: RawDivarDetailPage, label: string): string | null {
  return raw.infoRows[label] ?? null;
}

/**
 * Pure `SourceAdapter.parse` stage: reorganizes `RawDivarDetailPage`'s label/value soup into
 * named fields. Still entirely untrusted source text — no parsing/validation happens here,
 * that's `normalize`'s job.
 */
export function parseDivarDetailPage(raw: RawDivarDetailPage): ParsedDivarFields | null {
  const canonicalUrl = raw.canonicalUrl ?? raw.requestedUrl;
  const sourcePostingId =
    extractSourcePostingId(canonicalUrl) ?? extractSourcePostingId(raw.requestedUrl);
  if (sourcePostingId === null) return null;

  return {
    sourcePostingId,
    canonicalUrl,
    title: raw.title,
    description: raw.jsonLdDescription,
    areaRaw: fromGroupRow(raw, AREA_LABEL),
    buildingAgeYearRaw: fromGroupRow(raw, BUILDING_AGE_LABEL),
    roomsRaw: fromGroupRow(raw, ROOMS_LABEL),
    priceRaw: fromInfoRow(raw, PRICE_LABEL),
    floorRaw: fromInfoRow(raw, FLOOR_LABEL),
    amenitiesText: raw.bodyText,
  };
}
