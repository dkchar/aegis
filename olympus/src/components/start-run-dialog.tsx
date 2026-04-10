import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { fetchReadyIssues } from "../lib/api-client";
import { colors } from "../theme/tokens";
import type { ReadyIssueSummary } from "../types/dashboard-state";

export interface StartRunDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onScout: (issueId: string) => Promise<ScoutResult>;
  onImplement: (issueId: string) => Promise<void>;
  loadReadyIssues?: () => Promise<ReadyIssueSummary[]>;
}

export interface ScoutResult {
  ok: boolean;
  message: string;
  assessment?: string;
  raw?: Record<string, unknown>;
}

type ScoutPhase = "idle" | "scouting" | "complete" | "error" | "implementing";

export function StartRunDialog(props: StartRunDialogProps): JSX.Element {
  const {
    isOpen,
    onClose,
    onScout,
    onImplement,
    loadReadyIssues = fetchReadyIssues,
  } = props;
  const [issueId, setIssueId] = useState("");
  const [phase, setPhase] = useState<ScoutPhase>("idle");
  const [scoutResult, setScoutResult] = useState<ScoutResult | null>(null);
  const [scoutError, setScoutError] = useState<string | null>(null);
  const [implementError, setImplementError] = useState<string | null>(null);
  const [readyIssues, setReadyIssues] = useState<ReadyIssueSummary[]>([]);
  const [readyQueueError, setReadyQueueError] = useState<string | null>(null);
  const [isLoadingReadyIssues, setIsLoadingReadyIssues] = useState(false);

  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (isOpen) {
      selectRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setPhase("idle");
      setScoutResult(null);
      setScoutError(null);
      setImplementError(null);
      setReadyIssues([]);
      setReadyQueueError(null);
      setIssueId("");
      setIsLoadingReadyIssues(false);
      return;
    }

    let active = true;
    setIsLoadingReadyIssues(true);
    setReadyQueueError(null);
    void loadReadyIssues()
      .then((issues) => {
        if (!active) return;
        setReadyIssues(issues);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Unable to load the ready queue.";
        setReadyQueueError(message);
      })
      .finally(() => {
        if (active) {
          setIsLoadingReadyIssues(false);
        }
      });

    return () => {
      active = false;
    };
  }, [isOpen, loadReadyIssues]);

  const handleScout = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();

      const trimmed = issueId.trim();
      if (!trimmed || phase === "scouting") {
        return;
      }

      setPhase("scouting");
      setScoutError(null);
      setScoutResult(null);
      setImplementError(null);

      try {
        const result = await onScout(trimmed);
        if (result.ok) {
          setScoutResult(result);
          setPhase("complete");
          return;
        }

        setScoutError(result.message || "Scout returned an error");
        setPhase("error");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        setScoutError(message);
        setPhase("error");
      }
    },
    [issueId, onScout, phase],
  );

  const handleImplement = useCallback(async () => {
    const trimmed = issueId.trim();
    if (!trimmed || phase === "implementing") {
      return;
    }

    setPhase("implementing");
    setImplementError(null);

    try {
      await onImplement(trimmed);
      onClose();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setImplementError(message);
      setPhase("complete");
    }
  }, [issueId, onClose, onImplement, phase]);

  const handleClose = useCallback(() => {
    if (phase === "scouting" || phase === "implementing") {
      return;
    }
    onClose();
  }, [onClose, phase]);

  if (!isOpen) {
    return <div data-testid="start-run-dialog" />;
  }

  return (
    <div
      data-testid="start-run-dialog"
      role="dialog"
      aria-label="Start Run"
      aria-modal="true"
    >
      <div
        className="settings-overlay"
        onClick={handleClose}
        style={{ animation: "fadeIn 250ms ease forwards" }}
      >
        <div
          className="settings-panel"
          onClick={(event) => event.stopPropagation()}
          style={{
            animation: "slideIn 400ms ease forwards",
            maxWidth: "520px",
            width: "90%",
          }}
        >
          <div className="settings-header">
            <h2>Start Run</h2>
            <button
              className="settings-close-btn"
              onClick={handleClose}
              disabled={phase === "scouting" || phase === "implementing"}
              aria-label="Close dialog"
              style={{
                opacity: phase === "scouting" || phase === "implementing" ? 0.4 : 1,
                cursor: phase === "scouting" || phase === "implementing" ? "not-allowed" : "pointer",
              }}
            >
              {"\u2715"}
            </button>
          </div>

          <div
            style={{
              fontSize: "11px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: phaseColor(phase),
              marginBottom: "16px",
              padding: "4px 8px",
              borderRadius: "4px",
              backgroundColor: `${phaseColor(phase)}18`,
              display: "inline-block",
            }}
          >
            {phaseLabel(phase)}
          </div>

          <form onSubmit={handleScout} style={{ marginBottom: "20px" }}>
            <label
              htmlFor="start-run-ready-issue"
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: 600,
                color: "#b0b0b0",
                marginBottom: "8px",
              }}
            >
              Ready Issue
            </label>
            <div style={{ display: "flex", gap: "8px" }}>
              <select
                ref={selectRef}
                id="start-run-ready-issue"
                className="command-bar-input"
                value={issueId}
                onChange={(event) => setIssueId(event.target.value)}
                disabled={phase === "scouting" || phase === "implementing" || isLoadingReadyIssues}
                aria-label="Ready issue"
                style={{ flex: 1 }}
              >
                <option value="">Select a ready issue</option>
                {readyIssues.map((issue) => (
                  <option key={issue.id} value={issue.id}>
                    {`${issue.id} — ${issue.title}`}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="command-bar-submit"
                disabled={phase === "scouting" || phase === "implementing" || isLoadingReadyIssues || !issueId.trim()}
                aria-label="Scout issue"
              >
                {phase === "scouting" ? "Scouting..." : "Scout Issue"}
              </button>
            </div>
            <p
              style={{
                fontSize: "11px",
                color: "#7a8a9e",
                marginTop: "8px",
                marginBottom: 0,
              }}
            >
              {isLoadingReadyIssues
                ? "Loading the current ready queue..."
                : "Select a Beads issue from the ready queue to have Oracle scout it."}
            </p>
          </form>

          {readyQueueError && (
            <MessageCard tone="error" title="Ready Queue Error">
              {readyQueueError}
            </MessageCard>
          )}

          {scoutError && phase === "error" && (
            <MessageCard tone="error" title="Scout Error">
              {scoutError}
            </MessageCard>
          )}

          {scoutResult && phase === "complete" && (
            <MessageCard tone="success" title="Scout Assessment Complete">
              {scoutResult.assessment || scoutResult.message || "No assessment details provided."}
            </MessageCard>
          )}

          {implementError && (
            <MessageCard tone="error" title="Implement Error">
              {implementError}
            </MessageCard>
          )}

          <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", marginTop: "8px" }}>
            <button
              type="button"
              onClick={handleClose}
              disabled={phase === "scouting" || phase === "implementing"}
              style={{
                padding: "8px 20px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: 600,
                backgroundColor: "transparent",
                color: "#a0b4cc",
                border: "1px solid #4a5a6e",
                cursor: phase === "scouting" || phase === "implementing" ? "not-allowed" : "pointer",
                opacity: phase === "scouting" || phase === "implementing" ? 0.5 : 1,
              }}
            >
              Cancel
            </button>
            {phase === "complete" && (
              <button
                type="button"
                onClick={handleImplement}
                style={{
                  padding: "8px 20px",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: 600,
                  backgroundColor: colors.primary,
                  color: colors.bgPrimary,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Proceed to Implement
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageCard(
  props: {
    tone: "success" | "error";
    title: string;
    children: string;
  },
): JSX.Element {
  const { tone, title, children } = props;
  const color = tone === "success" ? colors.success : colors.danger;

  return (
    <div
      style={{
        padding: "12px",
        borderRadius: "8px",
        backgroundColor: `${color}18`,
        border: `1px solid ${color}44`,
        color: tone === "success" ? "#d0d0d0" : colors.danger,
        fontSize: "13px",
        marginBottom: "16px",
        whiteSpace: "pre-wrap",
      }}
    >
      <strong style={{ color }}>{`${title}:`}</strong> {children}
    </div>
  );
}

function phaseLabel(phase: ScoutPhase): string {
  switch (phase) {
    case "idle":
      return "Ready";
    case "scouting":
      return "Oracle is scouting...";
    case "complete":
      return "Assessment ready";
    case "error":
      return "Error";
    case "implementing":
      return "Starting implementation...";
    default:
      return phase;
  }
}

function phaseColor(phase: ScoutPhase): string {
  switch (phase) {
    case "idle":
      return "#a0b4cc";
    case "scouting":
      return colors.primary;
    case "complete":
      return colors.success;
    case "error":
      return colors.danger;
    case "implementing":
      return colors.primary;
    default:
      return "#a0b4cc";
  }
}
