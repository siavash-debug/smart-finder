/**
 * Digit normalization and safe numeral parsing.
 *
 * Handles the three digit scripts Divar text mixes freely: Persian (۰-۹), Arabic-Indic
 * (٠-٩), and Latin (0-9). Parsing is deliberately strict — MASTER_PROMPT §2/§16: "do not
 * silently turn malformed values into valid numbers." A string with any leftover non-numeric
 * character after normalization returns `null`, never a best-effort guess.
 */

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

const DIGIT_MAP = new Map<string, string>();
for (let i = 0; i < 10; i += 1) {
  DIGIT_MAP.set(PERSIAN_DIGITS[i]!, String(i));
  DIGIT_MAP.set(ARABIC_INDIC_DIGITS[i]!, String(i));
}

/**
 * Converts Persian and Arabic-Indic digits to Latin (ASCII) digits. Every other character,
 * including grouping separators and decimal points, passes through untouched — this function
 * does not interpret numbers, only digit glyphs.
 */
export function normalizeDigits(input: string): string {
  let out = "";
  for (const ch of input) out += DIGIT_MAP.get(ch) ?? ch;
  return out;
}

/** Grouping separators seen in Divar text: ASCII comma, Arabic thousands separator, and Arabic comma (used loosely as a grouping mark in some listings). */
const GROUPING_SEPARATOR = new RegExp("[,٬،]", "g");

/** Decimal points: ASCII period and the Arabic decimal separator. */
const DECIMAL_POINT = new RegExp("[.٫]", "g");

export interface DecimalLiteral {
  /** Always non-negative; a leading `-` is rejected rather than interpreted (real-estate
   * quantities are never negative, and a stray minus is more likely a dash/range marker). */
  integer: bigint;
  /** The fractional digits, as their own integer — e.g. `5.25` → `fraction = 25n`. */
  fraction: bigint;
  /** How many digits `fraction` has, so `5.05` (`fraction = 5n`) isn't confused with `5.5`. */
  fractionDigits: number;
}

/**
 * Parses a numeral after digit and separator normalization into an exact decimal literal —
 * never a JS `number`, so a value like `5.2` can later be multiplied by a scale (e.g. one
 * billion) with exact `bigint` arithmetic instead of floating point (MASTER_PROMPT §3,
 * "avoid floating-point money calculations").
 *
 * Rejects (`null`): empty input, more than one decimal point, a leading/trailing decimal
 * point, a negative sign, grouping separators in the wrong place (e.g. `"12,5"`, where the
 * final group isn't exactly three digits), or any leftover non-digit character. This is
 * intentionally strict — malformed input must fail, not be coerced into a plausible-looking
 * number.
 */
export function parseDecimalLiteral(input: string): DecimalLiteral | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  const ascii = normalizeDigits(trimmed);

  const decimalPointCount = (ascii.match(DECIMAL_POINT) ?? []).length;
  if (decimalPointCount > 1) return null;

  const [rawIntegerPart, rawFractionPart] = ascii.split(DECIMAL_POINT);
  if (rawFractionPart !== undefined && rawFractionPart === "") return null; // trailing "."

  const integerPart = rawIntegerPart ?? "";
  if (!isValidGroupedInteger(integerPart)) return null;

  const fractionPart = rawFractionPart?.replace(GROUPING_SEPARATOR, "") ?? "";
  if (rawFractionPart !== undefined && !/^[0-9]+$/.test(fractionPart)) return null;

  const integerDigits = integerPart.replace(GROUPING_SEPARATOR, "");
  if (integerDigits === "") return null;

  return {
    integer: BigInt(integerDigits),
    fraction: fractionPart === "" ? 0n : BigInt(fractionPart),
    fractionDigits: fractionPart.length,
  };
}

/**
 * Validates the integer part's grouping: either no separators at all (`"1250"`), or
 * separators that mark exact thousands groups (`"1,250"`, `"12,500,000"`). A mis-grouped
 * number like `"12,5"` or `"1,2345"` is rejected rather than silently accepted with the
 * separators just stripped — a malformed grouping is a sign the input isn't a clean number.
 */
function isValidGroupedInteger(part: string): boolean {
  if (part === "") return false;
  if (!part.includes(",") && !new RegExp("[٬،]").test(part)) {
    return /^[0-9]+$/.test(part);
  }
  const groups = part.split(GROUPING_SEPARATOR);
  if (groups.some((g) => g === "")) return false;
  const [first, ...rest] = groups;
  if (!first || !/^[0-9]{1,3}$/.test(first)) return false;
  return rest.every((g) => /^[0-9]{3}$/.test(g));
}

/**
 * Parses a plain (non-decimal) integer, e.g. an area in square meters or a room count.
 * Returns `null` for anything that isn't a clean, non-negative, optionally-grouped integer —
 * including a value with a decimal point, which callers that expect a whole number should
 * reject rather than truncate.
 */
export function parseInteger(input: string): number | null {
  const literal = parseDecimalLiteral(input);
  if (literal === null || literal.fractionDigits > 0) return null;
  if (literal.integer > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(literal.integer);
}

/**
 * Exact `decimal * scale` as a `bigint`, with no floating-point step. Returns `null` when the
 * decimal's fractional part cannot be represented exactly at this scale — e.g. `5.1234567`
 * (Toman) at a scale of one million is `5,123,456.7`, a fractional Toman, which is not a
 * valid amount. Rather than round or truncate (inventing precision that wasn't stated), this
 * is treated as unparseable.
 */
export function scaleDecimalToBigInt(literal: DecimalLiteral, scale: bigint): bigint | null {
  const scaled = literal.integer * scale;
  if (literal.fractionDigits === 0) return scaled;

  const fractionScale = 10n ** BigInt(literal.fractionDigits);
  const fractionContribution = literal.fraction * scale;
  if (fractionContribution % fractionScale !== 0n) return null;

  return scaled + fractionContribution / fractionScale;
}
