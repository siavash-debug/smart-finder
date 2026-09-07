import { describe, expect, it } from "vitest";

import { isTelegramUpdate } from "./types.js";

describe("isTelegramUpdate", () => {
  it("accepts a minimal valid message update", () => {
    expect(
      isTelegramUpdate({
        update_id: 1,
        message: { message_id: 1, chat: { id: 1 }, from: { id: 1 }, text: "/start" },
      }),
    ).toBe(true);
  });

  it("accepts a minimal valid callback query update", () => {
    expect(
      isTelegramUpdate({
        update_id: 1,
        callback_query: { id: "cbq-1", from: { id: 1 }, data: "pref:ack" },
      }),
    ).toBe(true);
  });

  it("accepts an update with neither message nor callback_query (an update type we don't handle)", () => {
    expect(isTelegramUpdate({ update_id: 1 })).toBe(true);
  });

  it("rejects null and non-objects", () => {
    expect(isTelegramUpdate(null)).toBe(false);
    expect(isTelegramUpdate("update")).toBe(false);
    expect(isTelegramUpdate(42)).toBe(false);
    expect(isTelegramUpdate(undefined)).toBe(false);
  });

  it("rejects a missing update_id", () => {
    expect(isTelegramUpdate({ message: { message_id: 1, chat: { id: 1 } } })).toBe(false);
  });

  it("rejects a non-numeric update_id", () => {
    expect(isTelegramUpdate({ update_id: "1" })).toBe(false);
  });

  it("rejects a message with no chat", () => {
    expect(isTelegramUpdate({ update_id: 1, message: { message_id: 1 } })).toBe(false);
  });

  it("rejects a message with a non-numeric chat id", () => {
    expect(
      isTelegramUpdate({ update_id: 1, message: { message_id: 1, chat: { id: "not-a-number" } } }),
    ).toBe(false);
  });

  it("rejects a callback_query with no from", () => {
    expect(isTelegramUpdate({ update_id: 1, callback_query: { id: "cbq-1" } })).toBe(false);
  });

  it("rejects malformed/attacker-crafted payloads without throwing", () => {
    const malformed = [
      { update_id: 1, message: "not an object" },
      { update_id: 1, message: { message_id: 1, chat: { id: 1 }, text: 12345 } },
      { update_id: 1, callback_query: { id: 1, from: { id: 1 } } }, // id should be string
      "just a raw string",
      [1, 2, 3],
      { update_id: Number.NaN },
    ];
    for (const value of malformed) {
      expect(() => isTelegramUpdate(value)).not.toThrow();
      expect(isTelegramUpdate(value)).toBe(false);
    }
  });
});
