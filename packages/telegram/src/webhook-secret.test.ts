import { describe, expect, it } from "vitest";

import { verifyWebhookSecret } from "./webhook-secret.js";

describe("verifyWebhookSecret", () => {
  it("accepts the exact matching secret", () => {
    expect(verifyWebhookSecret("correct-secret", "correct-secret")).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(verifyWebhookSecret("wrong-secret", "correct-secret")).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyWebhookSecret(null, "correct-secret")).toBe(false);
    expect(verifyWebhookSecret(undefined, "correct-secret")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(verifyWebhookSecret("", "correct-secret")).toBe(false);
  });

  it("rejects a secret that is a prefix of the correct one", () => {
    expect(verifyWebhookSecret("correct", "correct-secret")).toBe(false);
  });

  it("rejects a secret differing only in the last character", () => {
    expect(verifyWebhookSecret("correct-secreT", "correct-secret")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(verifyWebhookSecret("Correct-Secret", "correct-secret")).toBe(false);
  });
});
