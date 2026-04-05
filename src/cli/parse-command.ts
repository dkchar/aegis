/**
 * Deterministic direct-command parser for the S07 MVP command family.
 *
 * The parser only recognizes the canonical command surface from SPECv2 §7.3.
 * It does not execute anything; it only classifies input for later routing.
 */

import { isSafeIssueId } from "../shared/issue-id.js";

export const DIRECT_COMMAND_NAMES = [
  "scout",
  "implement",
  "review",
  "process",
  "status",
  "pause",
  "resume",
  "auto on",
  "auto off",
  "scale",
  "kill",
  "restart",
  "focus",
  "tell",
  "add_learning",
  "reprioritize",
  "summarize",
] as const;

export type DirectCommandName = (typeof DIRECT_COMMAND_NAMES)[number];

export const DIRECT_COMMAND_KINDS = [
  "scout",
  "implement",
  "review",
  "process",
  "status",
  "pause",
  "resume",
  "auto_on",
  "auto_off",
  "scale",
  "kill",
  "restart",
  "focus",
  "tell",
  "add_learning",
  "reprioritize",
  "summarize",
] as const;

export type DirectCommandKind = (typeof DIRECT_COMMAND_KINDS)[number];

export interface ScoutLikeCommand {
  kind: "scout" | "implement" | "review" | "process";
  issueId: string;
}

export interface FixedCommand {
  kind:
    | "status"
    | "pause"
    | "resume"
    | "auto_on"
    | "auto_off"
    | "scale"
    | "kill"
    | "restart"
    | "focus"
    | "tell"
    | "add_learning"
    | "reprioritize"
    | "summarize";
}

export interface UnsupportedCommand {
  kind: "unsupported";
  input: string;
  reason: string;
}

export type ParsedCommand = ScoutLikeCommand | FixedCommand | UnsupportedCommand;

const ISSUE_SCOPED_COMMANDS = new Set<DirectCommandName>([
  "scout",
  "implement",
  "review",
  "process",
]);

const FIXED_COMMAND_KINDS = new Set<DirectCommandKind>([
  "status",
  "pause",
  "resume",
  "auto_on",
  "auto_off",
  "scale",
  "kill",
  "restart",
  "focus",
  "tell",
  "add_learning",
  "reprioritize",
  "summarize",
]);

function normalizeCommandName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function unsupported(input: string, reason: string): UnsupportedCommand {
  return {
    kind: "unsupported",
    input,
    reason,
  };
}

export function parseCommand(input: string): ParsedCommand {
  const normalized = normalizeCommandName(input);

  if (normalized === "") {
    return unsupported(input, "Command text is empty.");
  }

  const parts = normalized.split(" ");
  const commandName = parts[0];

  if (commandName === "auto" && parts.length === 2) {
    if (parts[1] === "on") {
      return { kind: "auto_on" };
    }
    if (parts[1] === "off") {
      return { kind: "auto_off" };
    }
    return unsupported(input, `Unsupported auto subcommand: ${parts[1]}.`);
  }

  if (ISSUE_SCOPED_COMMANDS.has(commandName as DirectCommandName)) {
    if (parts.length !== 2 || parts[1] === "") {
      return unsupported(input, `${commandName} requires an issue id.`);
    }

    if (!isSafeIssueId(parts[1])) {
      return unsupported(input, `Invalid issue id: ${parts[1]}.`);
    }

    return {
      kind: commandName as ScoutLikeCommand["kind"],
      issueId: parts[1],
    };
  }

  if (FIXED_COMMAND_KINDS.has(commandName as DirectCommandKind) && parts.length === 1) {
    return {
      kind: commandName as FixedCommand["kind"],
    };
  }

  return unsupported(input, `Unsupported direct command: ${normalized}.`);
}
