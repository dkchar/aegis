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
