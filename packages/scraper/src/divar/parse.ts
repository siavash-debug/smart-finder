import { classifyInfoRows } from "./semantic-fields.js";
import { extractSourcePostingId } from "./url.js";
import type { ParsedDivarFields, RawDivarDetailPage } from "./types.js";

const AREA_LABEL = "متراژ";
const BUILDING_AGE_LABEL = "ساخت";
const ROOMS_LABEL = "اتاق";

function fromGroupRow(raw: RawDivarDetailPage, label: string): string | null {
  if (raw.groupRow === null) return null;
  const index = raw.groupRow.headers.indexOf(label);
  if (index === -1) return null;
  return raw.groupRow.values[index] ?? null;
}

/**
 * Pure `SourceAdapter.parse` stage: reorganizes `RawDivarDetailPage`'s label/value soup into
 * named fields. Still entirely untrusted source text — no parsing/validation happens here,
 * that's `normalize`'s job.
 *
 * Info-row fields (price/rent/floor) go through `semantic-fields.ts`'s `classifyInfoRows`
 * rather than exact-label lookup: the same field can be labeled with harmless wording/Unicode
 * variation (confirmed real case — "اجارهٔ ماهانه" vs "اجاره ماهانه", a combining Arabic
 * hamza), so classification is by normalized-label *meaning*, not brittle exact-string match.
 * `priceRaw` is populated from whichever of rent's `deposit` or sale's `saleTotalPrice`
 * category is actually present on the page (the two are mutually exclusive per listing,
 * confirmed against real live sale and rent pages) — `salePricePerSqm` deliberately never
 * feeds it, so a per-square-meter figure can never overwrite a total price.
 */
export function parseDivarDetailPage(raw: RawDivarDetailPage): ParsedDivarFields | null {
  const canonicalUrl = raw.canonicalUrl ?? raw.requestedUrl;
  const sourcePostingId =
    extractSourcePostingId(canonicalUrl) ?? extractSourcePostingId(raw.requestedUrl);
  if (sourcePostingId === null) return null;

  const { byCategory } = classifyInfoRows(raw.infoRows);

  return {
    sourcePostingId,
    canonicalUrl,
    title: raw.title,
    description: raw.jsonLdDescription,
    areaRaw: fromGroupRow(raw, AREA_LABEL),
    buildingAgeYearRaw: fromGroupRow(raw, BUILDING_AGE_LABEL),
    roomsRaw: fromGroupRow(raw, ROOMS_LABEL),
    priceRaw: byCategory.deposit ?? byCategory.saleTotalPrice ?? null,
    floorRaw: byCategory.floor ?? null,
    monthlyRentRaw: byCategory.monthlyRent ?? null,
    rentConvertibilityRaw: byCategory.rentConvertibility ?? null,
    salePricePerSqmRaw: byCategory.salePricePerSqm ?? null,
    amenitiesText: raw.bodyText,
  };
}
