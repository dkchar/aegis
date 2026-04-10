import { useCallback, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { colors } from "../theme/tokens";

export interface CommandBarProps {
  onCommand: (command: string, payload?: Record<string, unknown>) => Promise<void>;
  onKill?: (agentId: string) => void;
  disabled?: boolean;
}

export interface CommandResult {
  command: string;
  success: boolean;
  result?: string;
  error?: string;
  timestamp: number;
}

interface CommandOption {
  value: string;
  label: string;
  needsIssueId?: boolean;
  needsAgentId?: boolean;
}

const COMMAND_OPTIONS: readonly CommandOption[] = [
  { value: "status", label: "Status" },
  { value: "scout", label: "Scout", needsIssueId: true },
  { value: "implement", label: "Implement", needsIssueId: true },
  { value: "review", label: "Review", needsIssueId: true },
  { value: "process", label: "Process", needsIssueId: true },
  { value: "focus", label: "Focus", needsIssueId: true },
  { value: "auto_on", label: "Auto On" },
  { value: "auto_off", label: "Auto Off" },
  { value: "pause", label: "Pause" },
  { value: "resume", label: "Resume" },
  { value: "kill", label: "Kill Agent", needsAgentId: true },
] as const;

function findCommandOption(command: string): CommandOption {
  return COMMAND_OPTIONS.find((option) => option.value === command) ?? COMMAND_OPTIONS[0];
}

function buildPayload(
  option: CommandOption,
  issueId: string,
  agentId: string,
): Record<string, unknown> | undefined {
  if (option.needsIssueId) {
    return { issueId: issueId.trim() };
  }

  if (option.needsAgentId) {
    return { agentId: agentId.trim() };
  }

  return undefined;
}

export function CommandBar(props: CommandBarProps): JSX.Element {
  const { onCommand, disabled = false } = props;
  const [selectedCommand, setSelectedCommand] = useState<string>("status");
  const [issueId, setIssueId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectRef = useRef<HTMLSelectElement>(null);
  const selectedOption = useMemo(
    () => findCommandOption(selectedCommand),
    [selectedCommand],
  );
  const canSubmit = !disabled
    && !isSubmitting
    && (!selectedOption.needsIssueId || issueId.trim().length > 0)
    && (!selectedOption.needsAgentId || agentId.trim().length > 0);

  const handleSubmit = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();
      if (!canSubmit) {
        return;
      }

      setIsSubmitting(true);
      try {
        await onCommand(selectedOption.value, buildPayload(selectedOption, issueId, agentId));
        if (selectedOption.needsIssueId) {
          setIssueId("");
        }
        if (selectedOption.needsAgentId) {
          setAgentId("");
        }
      } finally {
        setIsSubmitting(false);
        requestAnimationFrame(() => {
          selectRef.current?.focus();
        });
      }
    },
    [agentId, canSubmit, issueId, onCommand, selectedOption],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLSelectElement | HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <section data-testid="command-bar" className="command-bar" aria-label="Command Bar">
      <form className="command-bar-form" onSubmit={handleSubmit}>
        <label
          htmlFor="structured-command"
          style={{
            display: "block",
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.5px",
            marginBottom: "8px",
            textTransform: "uppercase",
            color: "#a0b4cc",
          }}
        >
          Structured command
        </label>
        <select
          ref={selectRef}
          id="structured-command"
          className="command-bar-input"
          value={selectedCommand}
          onChange={(event) => setSelectedCommand(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || isSubmitting}
          aria-label="Structured command"
        >
          {COMMAND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {selectedOption.needsIssueId && (
          <div style={{ marginTop: "12px" }}>
            <label
              htmlFor="command-issue-id"
              style={{ display: "block", fontSize: "12px", marginBottom: "6px", color: "#b0b0b0" }}
            >
              Issue ID
            </label>
            <input
              id="command-issue-id"
              type="text"
              className="command-bar-input"
              value={issueId}
              onChange={(event) => setIssueId(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled || isSubmitting}
              aria-label="Issue ID"
              autoComplete="off"
              placeholder="e.g. aegis-8lq"
            />
          </div>
        )}

        {selectedOption.needsAgentId && (
          <div style={{ marginTop: "12px" }}>
            <label
              htmlFor="command-agent-id"
              style={{ display: "block", fontSize: "12px", marginBottom: "6px", color: "#b0b0b0" }}
            >
              Agent ID
            </label>
            <input
              id="command-agent-id"
              type="text"
              className="command-bar-input"
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled || isSubmitting}
              aria-label="Agent ID"
              autoComplete="off"
              placeholder="e.g. agent-123"
            />
          </div>
        )}

        <button
          type="submit"
          className="command-bar-submit"
          disabled={!canSubmit}
          aria-label="Submit command"
          style={{ marginTop: "12px" }}
        >
          {isSubmitting ? "Sending..." : "Submit"}
        </button>
      </form>

      <section
        aria-label="Ask Aegis"
        style={{
          marginTop: "16px",
          padding: "12px",
          borderRadius: "8px",
          border: "1px solid #304256",
          backgroundColor: "#1b2733",
        }}
      >
        <div
          style={{
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            color: colors.primary,
            marginBottom: "6px",
          }}
        >
          Ask Aegis
        </div>
        <p style={{ margin: 0, fontSize: "13px", color: "#9fb3c8", lineHeight: 1.5 }}>
          Natural-language Ask mode is not available in MVP yet. Use the structured command composer above.
        </p>
      </section>
    </section>
  );
}
