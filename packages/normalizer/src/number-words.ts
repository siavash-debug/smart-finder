/**
 * Persian number words → integer, for real-estate language (MASTER_PROMPT §11).
 *
 * Scoped to what Divar-style listings and buyer requests actually use: units, tens, hundreds,
 * and the three scale words (هزار/میلیون/میلیارد). Not a general literary-Persian numeral
 * parser — "prioritize real-estate language" (§11).
 *
 * One algorithm serves both callers: `صد و بیست و پنج` (125, no scale word — used by area and
 * room counts) and `پنج میلیارد و دویست میلیون` (5,200,000,000 — used by money). "و" is a
 * no-op separator; each scale word flushes the accumulated units/tens/hundreds into the total
 * at that magnitude and resets, exactly like reading the number aloud.
 */

const UNITS: Record<string, number> = {
  صفر: 0,
  یک: 1,
  دو: 2,
  سه: 3,
  چهار: 4,
  پنج: 5,
  شش: 6,
  هفت: 7,
  هشت: 8,
  نه: 9,
  ده: 10,
  یازده: 11,
  دوازده: 12,
  سیزده: 13,
  چهارده: 14,
  پانزده: 15,
  شانزده: 16,
  هفده: 17,
  هجده: 18,
  نوزده: 19,
};

const TENS: Record<string, number> = {
  بیست: 20,
  سی: 30,
  چهل: 40,
  پنجاه: 50,
  شصت: 60,
  هفتاد: 70,
  هشتاد: 80,
  نود: 90,
};

const HUNDREDS: Record<string, number> = {
  صد: 100,
  دویست: 200,
  سیصد: 300,
  چهارصد: 400,
  پانصد: 500,
  ششصد: 600,
  هفتصد: 700,
  هشتصد: 800,
  نهصد: 900,
};

/** Exported so `money.ts` can recognize the same scale words after a leading digit. */
export const SCALE_WORDS: Readonly<Record<string, bigint>> = {
  هزار: 1_000n,
  میلیون: 1_000_000n,
  میلیارد: 1_000_000_000n,
};

const SEPARATOR_TOKEN = "و";

/**
 * Parses a whitespace-separated Persian number-word phrase to a `bigint`. Returns `null` for
 * anything that isn't cleanly one of these words — including a phrase mixing in digits, an
 * unrecognized word, or an empty phrase — so a caller never gets a guessed value back
 * (MASTER_PROMPT §16, §40).
 */
export function parseNumberWordsToBigInt(text: string): bigint | null {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  let total = 0n;
  let current = 0n;
  let sawAnyValue = false;

  for (const token of tokens) {
    if (token === SEPARATOR_TOKEN) continue;

    if (token in UNITS) {
      current += BigInt(UNITS[token]!);
      sawAnyValue = true;
      continue;
    }
    if (token in TENS) {
      current += BigInt(TENS[token]!);
      sawAnyValue = true;
      continue;
    }
    if (token in HUNDREDS) {
      current += BigInt(HUNDREDS[token]!);
      sawAnyValue = true;
      continue;
    }
    if (token in SCALE_WORDS) {
      const scale = SCALE_WORDS[token]!;
      // "میلیون" with nothing said before it (e.g. a lone scale word) means one of that
      // scale, not zero — the classic word-numeral convention ("a million" ≈ "یک میلیون").
      total += (sawAnyValue ? current : 1n) * scale;
      current = 0n;
      sawAnyValue = true;
      continue;
    }

    // An unrecognized token means this is not a clean number-word phrase.
    return null;
  }

  if (!sawAnyValue) return null;
  return total + current;
}
