import { describe, expect, it } from "vitest";

import { parseInput } from "./commands.js";

describe("parseInput", () => {
  it("parses /start", () => {
    expect(parseInput("/start")).toEqual({ kind: "command", command: "start", args: [] });
  });

  it("parses /help", () => {
    expect(parseInput("/help")).toEqual({ kind: "command", command: "help", args: [] });
  });

  it("parses /status", () => {
    expect(parseInput("/status")).toEqual({ kind: "command", command: "status", args: [] });
  });

  it("parses command arguments", () => {
    expect(parseInput("/start foo bar")).toEqual({
      kind: "command",
      command: "start",
      args: ["foo", "bar"],
    });
  });

  it("strips a @botusername suffix", () => {
    expect(parseInput("/start@my_house_bot")).toEqual({
      kind: "command",
      command: "start",
      args: [],
    });
  });

  it("is case-insensitive on the command word", () => {
    expect(parseInput("/START")).toEqual({ kind: "command", command: "start", args: [] });
  });

  it("treats an unrecognized slash command as unknown_command", () => {
    expect(parseInput("/nonexistent")).toEqual({ kind: "unknown_command", raw: "/nonexistent" });
  });

  it("treats plain text as text, not a command", () => {
    expect(parseInput("۸۰ تا ۱۰۰ متر، دو خواب")).toEqual({
      kind: "text",
      text: "۸۰ تا ۱۰۰ متر، دو خواب",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(parseInput("  /start  ")).toEqual({ kind: "command", command: "start", args: [] });
  });

  it("treats an empty message as text", () => {
    expect(parseInput("")).toEqual({ kind: "text", text: "" });
  });

  it("treats a bare slash as an unknown command, not a crash", () => {
    expect(parseInput("/")).toEqual({ kind: "unknown_command", raw: "/" });
  });
});
