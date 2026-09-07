/**
 * Money parsing for Persian real-estate text (MASTER_PROMPT §3).
 *
 * Canonical unit is Toman, stored as `bigint` — never a float (ADR-0005). Every arithmetic
 * step goes through `scaleDecimalToBigInt`'s exact `bigint` multiplication; nothing here ever
 * touches a JS `number` for a money value.
 *
 * Grammar this module understands, expressed informally:
 *
 *   money       := ["حدود" | "تقریبا" | "تقریباً" | "نزدیک به" | "نزدیک"] amount
 *   amount      := range | compound
 *   range       := segment "تا" segment          -- "۵ تا ۶ میلیارد"
 *   compound    := segment ("و" segment)*         -- "۵ میلیارد و ۲۰۰ میلیون"
 *   segment     := digitNumber [scaleWord]         -- "۵ میلیارد", "۳۵۰ میلیون", "۵.۲ میلیارد"
 *               |  numberWordPhrase                -- "پنج میلیارد" (see number-words.ts)
 *
 * A leading "متری" / "هر متر" / "هرمتر" marks a per-square-meter price. A trailing "تومان" or
 * "ریال" states the currency explicitly; "ریال" amounts are converted to Toman (÷10) exactly,
 * and rejected rather than rounded if the result would not be a whole Toman.
 *
 * MASTER_PROMPT §3 requires "do not guess currency when the input is genuinely ambiguous": if
 * neither an explicit currency word nor a scale word (هزار/میلیون/میلیارد) appears anywhere in
 * the expression, the whole thing is unparseable — a bare number carries no reliable unit.
 */

import { normalizeDigits, parseDecimalLiteral, scaleDecimalToBigInt } from "./digits.js";
import { parseNumberWordsToBigInt, SCALE_WORDS } from "./number-words.js";
import { normalizeText } from "./text.js";

interface MoneyBase {
  /** True when the source used an approximation marker ("حدود ۵ میلیارد"). */
  approximate: boolean;
  /** True for "متری ۱۲۰ میلیون" style per-square-meter prices; false for a total price. */
  perSquareMeter: boolean;
  /** The original, unmodified input — preserved per MASTER_PROMPT §3. */
  sourceText: string;
}

export type MoneyParseResult =
  | (MoneyBase & { kind: "exact"; amountToman: bigint })
  | (MoneyBase & { kind: "range"; minToman: bigint; maxToman: bigint })
  | { kind: "unknown"; sourceText: string };

const APPROX_MARKERS = ["حدود", "تقریبا", "تقریباً", "نزدیک به", "نزدیک"];
const PER_SQUARE_METER_MARKERS = ["متری", "هر متر", "هرمتر"];
const RANGE_TOKEN = "تا";
const AND_TOKEN = "و";
const CURRENCY_TOKENS = new Set(["تومان", "ریال"]);

/** Strips a marker phrase if `text` starts with it, returning whether it matched. */
function stripLeadingMarker(
  text: string,
  markers: readonly string[],
): { text: string; matched: boolean } {
  for (const marker of markers) {
    if (text === marker) return { text: "", matched: true };
    if (text.startsWith(`${marker} `))
      return { text: text.slice(marker.length + 1).trim(), matched: true };
  }
  return { text, matched: false };
}

/** Finds the currency token anywhere in the (space-tokenized) text and removes it. */
function extractCurrency(text: string): { text: string; currency: "toman" | "rial" | null } {
  const tokens = text.split(" ").filter(Boolean);
  const rial = tokens.includes("ریال");
  const toman = tokens.includes("تومان");
  const currency = rial ? "rial" : toman ? "toman" : null;
  const remaining = tokens.filter((t) => !CURRENCY_TOKENS.has(t)).join(" ");
  return { text: remaining, currency };
}

/** Splits on the first standalone "تا" token, if present. Token-based, not regex `\b` —
 *  `\b` is unreliable across non-Latin scripts since Persian letters aren't `\w`. */
function splitOnRange(text: string): { left: string; right: string } | null {
  const tokens = text.split(" ").filter(Boolean);
  const index = tokens.indexOf(RANGE_TOKEN);
  if (index <= 0 || index >= tokens.length - 1) return null;
  return { left: tokens.slice(0, index).join(" "), right: tokens.slice(index + 1).join(" ") };
}

/** Splits on every standalone "و" token, for compound sums like "۵ میلیارد و ۲۰۰ میلیون". */
function splitOnAnd(text: string): string[] {
  const tokens = text.split(" ").filter(Boolean);
  const segments: string[][] = [[]];
  for (const token of tokens) {
    if (token === AND_TOKEN) segments.push([]);
    else segments[segments.length - 1]!.push(token);
  }
  return segments.map((s) => s.join(" ")).filter((s) => s !== "");
}

interface ResolvedSegment {
  valueToman: bigint;
  /** True only for a bare digit number with no attached scale word (e.g. the "۵" in
   *  "۵ تا ۶ میلیارد") — ambiguous on its own, resolved by borrowing a sibling's scale in a
   *  range, and rejected outright as part of a multi-term "و" compound. */
  bareDigitNoScale: boolean;
}

const LEADING_NUMBER = new RegExp("^([0-9]+(?:[.,][0-9]+)*)\\s*(.*)$");

function resolveSegment(rawSegment: string): ResolvedSegment | null {
  const segment = rawSegment.trim();
  if (segment === "") return null;

  const match = LEADING_NUMBER.exec(segment);
  if (match) {
    const [, numberPart, remainderRaw] = match;
    const literal = parseDecimalLiteral(numberPart!);
    if (literal === null) return null;
    const remainder = remainderRaw!.trim();

    if (remainder === "") {
      if (literal.fractionDigits > 0) return null; // a fractional bare number has no unit
      return { valueToman: literal.integer, bareDigitNoScale: true };
    }

    const scale = SCALE_WORDS[remainder];
    if (scale === undefined) return null; // leftover text that isn't a recognized scale word
    const value = scaleDecimalToBigInt(literal, scale);
    if (value === null) return null;
    return { valueToman: value, bareDigitNoScale: false };
  }

  const wordValue = parseNumberWordsToBigInt(segment);
  if (wordValue === null) return null;
  return { valueToman: wordValue, bareDigitNoScale: false };
}

/** Sums a compound's segments; rejects the whole thing if any but the sole segment is a bare,
 *  unscaled digit — combining e.g. "۵" with a scaled sibling via "و" is genuinely ambiguous. */
function resolveCompound(text: string): bigint | null {
  const segments = splitOnAnd(text);
  if (segments.length === 0) return null;

  const resolved = segments.map(resolveSegment);
  if (resolved.some((r) => r === null)) return null;
  const values = resolved as ResolvedSegment[];

  if (values.length > 1 && values.some((v) => v.bareDigitNoScale)) return null;

  return values.reduce((sum, v) => sum + v.valueToman, 0n);
}

function convertForCurrency(value: bigint, currency: "toman" | "rial" | null): bigint | null {
  if (currency !== "rial") return value;
  if (value % 10n !== 0n) return null; // not a whole Toman amount once converted
  return value / 10n;
}

export function parseMoney(rawText: string): MoneyParseResult {
  const sourceText = rawText;
  let working = normalizeDigits(normalizeText(rawText));

  const approx = stripLeadingMarker(working, APPROX_MARKERS);
  working = approx.text;
  const approximate = approx.matched;

  const perMeter = stripLeadingMarker(working, PER_SQUARE_METER_MARKERS);
  working = perMeter.text;
  const perSquareMeter = perMeter.matched;

  const { text: withoutCurrency, currency } = extractCurrency(working);
  working = withoutCurrency.trim();

  if (working === "") return { kind: "unknown", sourceText };

  // A bare number with neither an explicit currency nor a scale word carries no reliable
  // unit — MASTER_PROMPT §3, "do not guess currency when the input is genuinely ambiguous."
  const hasScaleWord = Object.keys(SCALE_WORDS).some((word) => working.split(" ").includes(word));
  if (currency === null && !hasScaleWord) return { kind: "unknown", sourceText };

  const range = splitOnRange(working);
  if (range) {
    const left = resolveSegment(range.left);
    const right = resolveSegment(range.right);
    if (!left || !right) return { kind: "unknown", sourceText };

    let minToman = left.valueToman;
    const maxToman = right.valueToman;
    if (left.bareDigitNoScale && !right.bareDigitNoScale) {
      // Borrow the right side's scale for the left, unscaled number: "۵ تا ۶ میلیارد".
      // `right.valueToman` is already scaled, so re-derive the scale factor from it is not
      // possible directly — instead, re-resolve using the scale word from the right segment.
      const rightScaleWord = Object.keys(SCALE_WORDS).find((word) =>
        range.right.trim().split(" ").includes(word),
      );
      if (rightScaleWord === undefined) return { kind: "unknown", sourceText };
      minToman = left.valueToman * SCALE_WORDS[rightScaleWord]!;
    } else if (left.bareDigitNoScale && right.bareDigitNoScale) {
      return { kind: "unknown", sourceText }; // neither side states a unit — ambiguous
    }

    const convertedMin = convertForCurrency(minToman, currency);
    const convertedMax = convertForCurrency(maxToman, currency);
    if (convertedMin === null || convertedMax === null) return { kind: "unknown", sourceText };

    return {
      kind: "range",
      minToman: convertedMin,
      maxToman: convertedMax,
      approximate,
      perSquareMeter,
      sourceText,
    };
  }

  const amount = resolveCompound(working);
  if (amount === null) return { kind: "unknown", sourceText };

  const converted = convertForCurrency(amount, currency);
  if (converted === null) return { kind: "unknown", sourceText };

  return { kind: "exact", amountToman: converted, approximate, perSquareMeter, sourceText };
}
