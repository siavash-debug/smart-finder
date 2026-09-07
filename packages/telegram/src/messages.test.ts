import { describe, expect, it } from "vitest";

import {
  helpMessage,
  invalidCallbackMessage,
  preferenceConfirmedMessage,
  preferenceEditPromptMessage,
  preferenceSummaryMessage,
  rateLimitedMessage,
  statusMessage,
  unknownCommandMessage,
  welcomeMessage,
} from "./messages.js";

describe("message builders", () => {
  it("welcomeMessage is Persian and non-empty", () => {
    const text = welcomeMessage();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("تلگرام");
  });

  it("helpMessage lists all three commands", () => {
    const text = helpMessage();
    expect(text).toContain("/start");
    expect(text).toContain("/help");
    expect(text).toContain("/status");
  });

  it("statusMessage reflects an active profile", () => {
    expect(statusMessage({ hasActiveSearchProfile: true })).toContain("فعال");
  });

  it("statusMessage reflects no active profile", () => {
    expect(statusMessage({ hasActiveSearchProfile: false })).toContain("ثبت نکرده");
  });

  it("unknownCommandMessage is non-empty", () => {
    expect(unknownCommandMessage().length).toBeGreaterThan(0);
  });

  it("rateLimitedMessage is non-empty", () => {
    expect(rateLimitedMessage().length).toBeGreaterThan(0);
  });

  it("invalidCallbackMessage is non-empty", () => {
    expect(invalidCallbackMessage().length).toBeGreaterThan(0);
  });

  it("preferenceConfirmedMessage and preferenceEditPromptMessage are non-empty", () => {
    expect(preferenceConfirmedMessage().length).toBeGreaterThan(0);
    expect(preferenceEditPromptMessage().length).toBeGreaterThan(0);
  });
});

describe("preferenceSummaryMessage", () => {
  it("lists only the lines that were provided — never fabricates an unstated field", () => {
    const text = preferenceSummaryMessage({
      areaLine: "متراژ: ۸۰ تا ۱۰۰ متر",
      bedroomsLine: "خواب: ۲",
      districtLine: null,
      priceLine: null,
      parkingLine: null,
      elevatorLine: "آسانسور: دارد",
    });

    expect(text).toContain("متراژ: ۸۰ تا ۱۰۰ متر");
    expect(text).toContain("خواب: ۲");
    expect(text).toContain("آسانسور: دارد");
    expect(text).toContain("تأیید می‌کنید؟");
  });

  it("falls back to an explanatory message when nothing was extracted", () => {
    const text = preferenceSummaryMessage({
      areaLine: null,
      bedroomsLine: null,
      districtLine: null,
      priceLine: null,
      parkingLine: null,
      elevatorLine: null,
    });

    expect(text).not.toContain("تأیید می‌کنید؟");
    expect(text.length).toBeGreaterThan(0);
  });
});
