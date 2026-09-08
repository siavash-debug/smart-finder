/**
 * Persian/Arabic character and whitespace normalization.
 *
 * This is the first step every other module in this package runs its input through
 * (MASTER_PROMPT §16, "normalize first"). It only canonicalizes character *forms* — it never
 * removes digits, numbers, or words, and it is deliberately idempotent:
 * `normalizeText(normalizeText(x)) === normalizeText(x)` (tested in `text.test.ts`).
 */

/**
 * Arabic presentation forms of Yeh/Kaf that appear in Divar listings (often copy-pasted from
 * Arabic-locale keyboards) are folded to their standard Persian forms. This is the single most
 * common source of "same word, different string" in Persian real-estate text.
 */
const CHAR_MAP: readonly (readonly [RegExp, string])[] = [
  [/[يى]/g, "ی"], // Arabic Yeh / Alef Maksura → Persian Yeh
  [/ك/g, "ک"], // Arabic Kaf → Persian Keheh
  [/[ۀە]/g, "ه"], // Heh variants → plain Heh (ezafe marker forms collapse to the base letter)
  // Alef with hamza above/below (أ/إ) are Arabic-orthography artifacts and safe to fold to
  // plain Alef. Alef with madda (آ) is deliberately EXCLUDED: it is a distinct, correct
  // Persian letter in its own right ("آپارتمان", "آسانسور"), not a typo variant — folding it
  // away would be exactly the "blindly destroy meaningful text" this module must not do.
  [/[إأ]/g, "ا"],
  [/ؤ/g, "و"], // Waw with hamza → plain Waw
  [/ئ/g, "ی"], // Yeh with hamza → plain Yeh
];

/**
 * Zero-width and directional-mark characters: ZWSP (U+200B), ZWNJ (U+200C, Persian
 * "نیم‌فاصله" half-space — e.g. "می‌خواهم"), ZWJ (U+200D), the LTR/RTL marks (U+200E/U+200F —
 * observed in real Divar price text, e.g. a RLM sitting before the digits of "۴,۱۰۰,۰۰۰,۰۰۰
 * تومان"; left unstripped, it isn't whitespace to `.trim()` and silently breaks
 * `money.ts`'s leading-digit match, per Phase 5's ADR-0016), and the BOM/ZWNBSP (U+FEFF).
 * Stripped entirely rather than kept: removing the ZWNJ from "می‌خواهم" merges it to
 * "میخواهم", which changes rendering but not meaning, and means every other pattern in this
 * package never has to account for an optional invisible character in the middle of a word.
 */
// Built via `new RegExp` from explicit \uXXXX escapes rather than a literal character class:
// pasting actual zero-width characters into source code makes them invisible in any diff or
// editor, which is exactly the kind of thing this module exists to catch in *other* people's
// text.
// Deliberate: ZWJ (U+200D) is one of the characters this class matches, not an accidental
// joiner between the others.
// eslint-disable-next-line no-misleading-character-class
const ZERO_WIDTH = new RegExp("[\\u200B\\u200C\\u200D\\u200E\\u200F\\uFEFF]", "g");

/**
 * Arabic combining diacritics (harakat/tanween/hamza-above/hamza-below/sukun/shadda,
 * U+064B-U+065F, plus superscript alef U+0670): optional pronunciation marks that do not
 * change a word's identity. Real Divar text has been observed with and without them on the
 * same word — e.g. "اجارهٔ ماهانه" (with a combining hamza above the heh, U+0654) vs "اجاره
 * ماهانه" (without it) both meaning "monthly rent". Unlike the precomposed heh-with-hamza
 * variants (`ۀ`/`ە`, already folded by CHAR_MAP below), this is a *combining* mark attached to
 * a separate base letter, so it needs its own strip rather than a substitution.
 */
const ARABIC_DIACRITICS = new RegExp("[\\u064B-\\u065F\\u0670]", "g");

/**
 * Punctuation Divar text uses interchangeably with Latin ASCII equivalents. Fixed-width vs.
 * spelled-out Persian isn't touched — only characters that mean the same thing regardless of
 * script are unified, so no information is lost.
 */
const PUNCTUATION_MAP: readonly (readonly [RegExp, string])[] = [
  [/،/g, ","], // Arabic comma
  [/؛/g, ";"], // Arabic semicolon
  [/٪/g, "%"], // Arabic percent sign
  [/[‐‑‒–—―]/g, "-"], // various dash widths → hyphen-minus
  [/[“”«»]/g, '"'],
  [/[‘’]/g, "'"],
];

/**
 * Every whitespace variant, plain and Unicode-width (non-breaking space and the various
 * fixed-width space codepoints Persian text sources sometimes use), collapses to one plain
 * space. Built via new RegExp with the s-class escape written twice in source: JS string
 * literals drop a backslash before an unrecognized letter, so a single backslash there
 * would silently turn into a bare letter and break the whitespace match.
 */
const WHITESPACE = new RegExp("[\\s\u00A0\u2000-\u200A\u202F\u205F\u3000]+", "g");

/**
 * Canonicalizes character forms, punctuation, and whitespace. Digits are intentionally left
 * alone here — `normalizeDigits` in `digits.ts` owns that, so callers can normalize text and
 * digits independently when only one is needed.
 *
 * Idempotent by construction: every substitution's output is already in its own target set
 * (e.g. `ی` never matches the Yeh-variant pattern again), and whitespace collapsing/trimming a
 * second time is a no-op.
 */
export function normalizeText(input: string): string {
  let out = input.normalize("NFC");

  out = out.replace(ZERO_WIDTH, "");
  out = out.replace(ARABIC_DIACRITICS, "");
  for (const [pattern, replacement] of CHAR_MAP) out = out.replace(pattern, replacement);
  for (const [pattern, replacement] of PUNCTUATION_MAP) out = out.replace(pattern, replacement);

  out = out.replace(WHITESPACE, " ").trim();

  return out;
}
