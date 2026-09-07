/**
 * Webhook secret-token verification (MASTER_PROMPT-adjacent Phase 4 §7). Telegram, when
 * configured with a `secret_token` on `setWebhook`, sends it back on every request as the
 * `X-Telegram-Bot-Api-Secret-Token` header — this is what proves a request genuinely came
 * from Telegram's servers, not an attacker who guessed the webhook URL.
 *
 * Uses `node:crypto`'s constant-time comparison rather than `===`: a naive string comparison
 * leaks how many leading characters matched through response-time differences, which is
 * exactly the kind of side channel a secret comparison must not have.
 */

import { timingSafeEqual } from "node:crypto";

export function verifyWebhookSecret(
  receivedHeaderValue: string | null | undefined,
  expectedSecret: string,
): boolean {
  if (receivedHeaderValue === null || receivedHeaderValue === undefined) return false;

  const received = Buffer.from(receivedHeaderValue, "utf8");
  const expected = Buffer.from(expectedSecret, "utf8");

  // timingSafeEqual throws on a length mismatch rather than returning false — lengths differing
  // is not itself secret information (an attacker can always probe length externally by
  // sending headers of different sizes and observing nothing but "rejected" either way), so
  // this short-circuit does not reopen the timing side channel the constant-time compare below
  // exists to close.
  if (received.length !== expected.length) return false;

  return timingSafeEqual(received, expected);
}
