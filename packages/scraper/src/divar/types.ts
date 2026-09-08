/** Raw, unparsed data pulled straight off a Divar detail page — every field is untrusted text
 *  or `null` when the page didn't have it. Nothing here is normalized yet. */
export interface RawDivarDetailPage {
  requestedUrl: string;
  /** From the JSON-LD block's own `url` field — Divar's stated canonical form, independent of
   *  which of the (possibly several) equivalent URLs was navigated to. */
  canonicalUrl: string | null;
  title: string | null;
  jsonLdDescription: string | null;
  /** Label → value, from the `unexpandable-info-row` rows (e.g. `{"ودیعه": "...", "طبقه": "۳ از ۵"}`). */
  infoRows: Record<string, string>;
  /** Positional header/value pairing from the `kt-group-row` table (متراژ/ساخت/اتاق). */
  groupRow: { headers: string[]; values: string[] } | null;
  /** Full page body text, for `parseAttribute`'s own noun+negation scanning. */
  bodyText: string;
}

/** `RawDivarDetailPage`'s fields reorganized by meaning, still as raw source strings — the
 *  `parse` stage's output, before anything touches `@smart-finder/normalizer`. */
export interface ParsedDivarFields {
  sourcePostingId: string;
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  areaRaw: string | null;
  buildingAgeYearRaw: string | null;
  roomsRaw: string | null;
  /** Rent's ودیعه (deposit) or sale's قیمت کل (total price) — whichever the page actually has;
   *  the two are mutually exclusive per listing. This is the only price field `normalize.ts`
   *  currently turns into `priceToman` (the schema has one price slot — see `salePricePerSqmRaw`
   *  below for the field that deliberately does NOT feed it). */
  priceRaw: string | null;
  floorRaw: string | null;
  /** اجارهٔ ماهانه / اجاره ماهانه — rent's monthly amount (e.g. "رایگان" for a deposit-only
   *  rental, or a money string). Recognized and preserved, but not yet normalized into a
   *  domain field: the schema has no column for it (a documented gap, not a silent drop — see
   *  ADR-0019). `null` when the row wasn't present (sale listings, or a rent listing missing it). */
  monthlyRentRaw: string | null;
  /** ودیعه و اجاره — convertibility status between deposit and monthly rent (e.g.
   *  "غیر قابل تبدیل"). Same not-yet-modeled situation as `monthlyRentRaw`. */
  rentConvertibilityRaw: string | null;
  /** قیمت هر متر — sale's price-per-square-meter. Deliberately never merged into `priceRaw`/
   *  `priceToman` (that would silently corrupt the total-price field with a much smaller
   *  per-unit figure). Same not-yet-modeled situation as the two rent fields above. */
  salePricePerSqmRaw: string | null;
  amenitiesText: string;
}
