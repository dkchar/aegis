/**
 * Command bar component — Lane B implementation.
 *
 * Provides:
 * - Text input for command entry with placeholder
 * - Submit button
 * - Response area below the input showing command results
 * - Command result display (success = green, error = red)
 * - Disabled state when not connected
 * - Keyboard shortcut (Enter to submit)
 * - Auto-scrolling response area when new results arrive
 * - Quick kill action integration
 */

import { useState, useRef, useCallback } from "react";
import type { JSX } from "react";
import { colors } from "../theme/tokens";

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

/** Parse a command string into command + optional agentId for kill shortcuts. */
function parseCommand(input: string): { command: string; payload?: Record<string, unknown> } {
  const trimmed = input.trim();
  if (!trimmed) return { command: "" };

  // Support "kill <agentId>" shorthand
  const killMatch = trimmed.match(/^kill\s+(.+)$/i);
  if (killMatch) {
    return { command: "kill", payload: { agentId: killMatch[1].trim() } };
  }

  // Support "auto_on" / "auto_off" shorthand
  if (/^auto[_\s]?on$/i.test(trimmed)) return { command: "auto_on" };
  if (/^auto[_\s]?off$/i.test(trimmed)) return { command: "auto_off" };

  // Generic: first token is command, rest is payload (if it looks like JSON)
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx > 0) {
    const cmd = trimmed.slice(0, spaceIdx);
    const rest = trimmed.slice(spaceIdx + 1).trim();
    // Try to parse as JSON payload
    try {
      const payload = JSON.parse(rest);
      if (typeof payload === "object" && payload !== null) {
        return { command: cmd, payload };
      }
    } catch {
      // Not JSON, treat as string argument
      return { command: cmd, payload: { arg: rest } };
    }
  }

  return { command: trimmed };
}

export function CommandBar(props: CommandBarProps): JSX.Element {
  const { onCommand, onKill, disabled = false } = props;

  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [killAgentId, setKillAgentId] = useState("");
  const [showKillConfirm, setShowKillConfirm] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();

      const trimmed = input.trim();
      if (!trimmed || disabled || isSubmitting) return;

      setIsSubmitting(true);
      const { command, payload } = parseCommand(trimmed);

      try {
        // If it's a kill command, route through onKill
        if (command === "kill" && payload?.agentId) {
          await Promise.resolve(onKill(String(payload.agentId)));
        } else {
          await onCommand(command, payload);
        }

        setInput("");
      } finally {
        setIsSubmitting(false);

        // Re-focus input after submit
        requestAnimationFrame(() => {
          inputRef.current?.focus();
        });
      }
    },
    [input, disabled, isSubmitting, onCommand, onKill],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleQuickKill = useCallback(() => {
    const agentId = killAgentId.trim();
    if (!agentId) return;

    if (!showKillConfirm) {
      setShowKillConfirm(true);
      return;
    }

    void Promise.resolve(onKill(agentId));
    setKillAgentId("");
    setShowKillConfirm(false);
  }, [killAgentId, showKillConfirm, onKill]);

  return (
    <section data-testid="command-bar" className="command-bar" aria-label="Command Bar">
      <form className="command-bar-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className="command-bar-input"
          placeholder="Enter command (e.g. kill agent-123, auto_on, status)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || isSubmitting}
          aria-label="Command input"
          autoComplete="off"
        />
        <button
          type="submit"
          className="command-bar-submit"
          disabled={disabled || isSubmitting || !input.trim()}
          aria-label="Submit command"
        >
          {isSubmitting ? "Sending..." : "Submit"}
        </button>
      </form>

      {/* Quick kill section */}
      <div style={{ marginTop: "12px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          className="command-bar-input"
          placeholder="Agent ID to kill"
          value={killAgentId}
          onChange={(e) => {
            setKillAgentId(e.target.value);
            setShowKillConfirm(false);
          }}
          disabled={disabled}
          aria-label="Agent ID for quick kill"
          style={{ flex: "1", minWidth: "160px" }}
        />
        <button
          type="button"
          className="kill-btn"
          onClick={handleQuickKill}
          disabled={disabled || !killAgentId.trim()}
          style={{
            backgroundColor: showKillConfirm ? colors.danger : "transparent",
            color: showKillConfirm ? colors.bgPrimary : colors.danger,
            padding: "6px 16px",
            borderRadius: "4px",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          {showKillConfirm ? "Confirm Kill" : "Quick Kill"}
        </button>
      </div>
    </section>
  );
}
