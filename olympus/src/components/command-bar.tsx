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

import { useState, useRef, useEffect, useCallback } from "react";
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

/** Format a timestamp to a readable time string. */
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString();
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
  const [results, setResults] = useState<CommandResult[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [killAgentId, setKillAgentId] = useState("");
  const [showKillConfirm, setShowKillConfirm] = useState(false);

  const resultsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll results when new entries arrive
  useEffect(() => {
    if (resultsRef.current) {
      resultsRef.current.scrollTop = resultsRef.current.scrollHeight;
    }
  }, [results]);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();

      const trimmed = input.trim();
      if (!trimmed || disabled || isSubmitting) return;

      setIsSubmitting(true);
      const { command, payload } = parseCommand(trimmed);

      // If it's a kill command, route through onKill
      if (command === "kill" && payload?.agentId) {
        try {
          onKill(String(payload.agentId));
          setResults((prev) => [
            ...prev,
            {
              command: `kill ${payload.agentId}`,
              success: true,
              result: `Agent ${payload.agentId} kill signal sent`,
              timestamp: Date.now(),
            },
          ]);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          setResults((prev) => [
            ...prev,
            {
              command: `kill ${payload.agentId}`,
              success: false,
              error: msg,
              timestamp: Date.now(),
            },
          ]);
        }
      } else {
        try {
          await onCommand(command, payload);
          setResults((prev) => [
            ...prev,
            {
              command: trimmed,
              success: true,
              result: "Command sent successfully",
              timestamp: Date.now(),
            },
          ]);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          setResults((prev) => [
            ...prev,
            {
              command: trimmed,
              success: false,
              error: msg,
              timestamp: Date.now(),
            },
          ]);
        }
      }

      setInput("");
      setIsSubmitting(false);

      // Re-focus input after submit
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
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

    onKill(agentId);
    setResults((prev) => [
      ...prev,
      {
        command: `kill ${agentId}`,
        success: true,
        result: `Agent ${agentId} kill signal sent`,
        timestamp: Date.now(),
      },
    ]);
    setKillAgentId("");
    setShowKillConfirm(false);
  }, [killAgentId, showKillConfirm, onKill]);

  const clearResults = useCallback(() => {
    setResults([]);
  }, []);

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

      {/* Command results area */}
      {results.length > 0 && (
        <div style={{ marginTop: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)" }}>
              Results ({results.length})
            </span>
            <button
              type="button"
              onClick={clearResults}
              style={{ fontSize: "12px", color: "var(--text-muted)" }}
            >
              Clear
            </button>
          </div>
          <div
            ref={resultsRef}
            className="command-results"
            style={{ maxHeight: "300px", overflowY: "auto" }}
          >
            {results.map((r, i) => (
              <div
                key={i}
                className={`command-result ${r.success ? "success" : "error"}`}
                style={{ display: "flex", flexDirection: "column", gap: "4px" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <code style={{ fontWeight: 600 }}>{r.command}</code>
                  <span style={{ fontSize: "11px", opacity: 0.7 }}>{formatTimestamp(r.timestamp)}</span>
                </div>
                {r.success && r.result && (
                  <span style={{ wordBreak: "break-word" }}>{r.result}</span>
                )}
                {r.error && (
                  <span style={{ wordBreak: "break-word" }}>{r.error}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
