/**
 * Minimal deterministic command parsing (MASTER_PROMPT-adjacent Phase 4 §8). Recognizes
 * `/start`, `/help`, `/status`; anything else with a leading `/` is `unknown`; anything
 * without one is plain free text (handled separately as a preference-extraction candidate,
 * not a command).
 */

export type CommandName = "start" | "help" | "status";

export type ParsedInput =
  | { kind: "command"; command: CommandName; args: string[] }
  | { kind: "unknown_command"; raw: string }
  | { kind: "text"; text: string };

const KNOWN_COMMANDS: ReadonlySet<CommandName> = new Set(["start", "help", "status"]);

/**
 * Parses one message's text. Telegram commands may carry a `@botusername` suffix
 * (`/start@my_bot`) when used in a group — stripped before matching. Command matching is
 * case-insensitive on the command word itself (Telegram's own clients only ever send
 * lowercase, but a hand-crafted webhook payload could send anything).
 */
export function parseInput(text: string): ParsedInput {
  const trimmed = text.trim();

  if (!trimmed.startsWith("/")) {
    return { kind: "text", text: trimmed };
  }

  const [firstToken, ...rest] = trimmed.split(/\s+/);
  const withoutSlash = (firstToken ?? "").slice(1);
  const withoutMention = withoutSlash.split("@")[0] ?? "";
  const normalized = withoutMention.toLowerCase();

  if (isCommandName(normalized)) {
    return { kind: "command", command: normalized, args: rest };
  }
  return { kind: "unknown_command", raw: trimmed };
}

function isCommandName(value: string): value is CommandName {
  return KNOWN_COMMANDS.has(value as CommandName);
}
