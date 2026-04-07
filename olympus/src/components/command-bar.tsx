/**
 * Command bar component contract.
 *
 * Lane B implements: direct command input, command bar UI, response area,
 * and kill action integration.
 */

import type { JSX } from "react";

export interface CommandBarProps {
  onCommand: (command: string, payload?: Record<string, unknown>) => Promise<void>;
  onKill: (agentId: string) => void;
  disabled?: boolean;
}

export interface CommandResult {
  command: string;
  success: boolean;
  result?: string;
  error?: string;
  timestamp: number;
}

export function CommandBar(_props: CommandBarProps): JSX.Element {
  // Lane B: implement command bar with input, response area, and kill integration
  return (
    <div data-testid="command-bar" role="region" aria-label="Command Bar">
      {/* Lane B: implement command bar content */}
    </div>
  );
}
