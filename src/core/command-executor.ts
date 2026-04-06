/**
 * Command execution contract for the S07 direct-command surface.
 *
 * Lane A will provide the actual routing implementation. This file defines
 * the stable command kinds, context inputs, and result shape the router uses.
 */

import type { ParsedCommand } from "../cli/parse-command.js";
import type { AutoLoopState } from "./auto-loop.js";
import type { OperatingModeState } from "./operating-mode.js";
import { DIRECT_COMMAND_KINDS } from "../cli/parse-command.js";

export const SUPPORTED_DIRECT_COMMAND_KINDS = DIRECT_COMMAND_KINDS;

export interface CommandExecutionContext {
  operatingMode: OperatingModeState;
  autoLoop: AutoLoopState;
  issueId: string | null;
}

export interface CommandExecutionResult {
  kind: ParsedCommand["kind"] | "unsupported";
  status: "handled" | "unsupported" | "declined";
  message: string;
}

export type CommandExecutor = (
  command: ParsedCommand,
  context: CommandExecutionContext,
) => Promise<CommandExecutionResult>;

/**
 * Map of issue-scoped commands to their declined reasons until their
 * owning slice lands. SPECv2 §7.3 requires that unsupported downstream
 * behaviors fail clearly.
 */
const DECLINED_COMMANDS: Record<string, string> = {
  scout: "scout dispatch requires S08 (Oracle)",
  implement: "implement dispatch requires Titan caste (S10)",
  review: "review dispatch requires Sentinel caste (S09)",
  process: "process dispatch requires auto-loop (Lane B, S07)",
};

/**
 * Create a command executor that routes parsed commands to their
 * appropriate result. Scout/implement/review/process are declined with
 * clear reasons; fixed commands are marked as handled; everything
 * else is marked unsupported.
 */
export function createCommandExecutor(
  _context: CommandExecutionContext,
): CommandExecutor {
  return async function executeCommand(
    command: ParsedCommand,
    _context: CommandExecutionContext,
  ): Promise<CommandExecutionResult> {
    if (command.kind === "unsupported") {
      return {
        kind: "unsupported",
        status: "unsupported",
        message: command.reason,
      };
    }

    const declinedReason = DECLINED_COMMANDS[command.kind];
    if (declinedReason) {
      return {
        kind: command.kind,
        status: "declined",
        message: declinedReason,
      };
    }

    // Fixed commands that don't need downstream deps are handled here.
    // Actual behavior wiring (mode transitions, auto-loop, etc.) is
    // done by the server/CLI layer that owns those concerns.
    return {
      kind: command.kind,
      status: "handled",
      message: `Command "${command.kind}" acknowledged.`,
    };
  };
}
