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
  priceRaw: string | null;
  floorRaw: string | null;
  amenitiesText: string;
}
