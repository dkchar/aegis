/**
 * Start Run dialog component — issue aegis-8lq.
 *
 * Provides:
 * - A modal dialog triggered by a "Start Run" button
 * - Text input for entering a Beads issue ID
 * - "Scout Issue" button that sends the scout command via steer API
 * - Displays scout progress and assessment result via SSE events
 * - "Proceed to Implement" button after scout completes
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { JSX } from "react";
import { colors } from "../theme/tokens";

export interface StartRunDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onScout: (issueId: string) => Promise<ScoutResult>;
  onImplement: (issueId: string) => Promise<void>;
}

export interface ScoutResult {
  ok: boolean;
  message: string;
  assessment?: string;
  raw?: Record<string, unknown>;
}

type ScoutPhase = "idle" | "scouting" | "complete" | "error" | "implementing";

export function StartRunDialog(props: StartRunDialogProps): JSX.Element {
  const { isOpen, onClose, onScout, onImplement } = props;

  const [issueId, setIssueId] = useState("");
  const [phase, setPhase] = useState<ScoutPhase>("idle");
  const [scoutResult, setScoutResult] = useState<ScoutResult | null>(null);
  const [scoutError, setScoutError] = useState<string | null>(null);
  const [implementError, setImplementError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input when the dialog opens
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setPhase("idle");
      setScoutResult(null);
      setScoutError(null);
      setImplementError(null);
      setIssueId("");
    }
  }, [isOpen]);

  const handleScout = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();

      const trimmed = issueId.trim();
      if (!trimmed || phase === "scouting") return;

      setPhase("scouting");
      setScoutError(null);
      setScoutResult(null);
      setImplementError(null);

      try {
        const result = await onScout(trimmed);
        if (result.ok) {
          setScoutResult(result);
          setPhase("complete");
        } else {
          setScoutError(result.message || "Scout returned an error");
          setPhase("error");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setScoutError(msg);
        setPhase("error");
      }
    },
    [issueId, phase, onScout],
  );

  const handleImplement = useCallback(async () => {
    const trimmed = issueId.trim();
    if (!trimmed || phase === "implementing") return;

    setPhase("implementing");
    setImplementError(null);

    try {
      await onImplement(trimmed);
      // After starting implementation, close the dialog
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setImplementError(msg);
      setPhase("complete");
    }
  }, [issueId, phase, onImplement, onClose]);

  const handleClose = useCallback(() => {
    // Only allow close if not actively scouting or implementing
    if (phase === "scouting" || phase === "implementing") return;
    onClose();
  }, [phase, onClose]);

  if (!isOpen) return <div data-testid="start-run-dialog" />;

  return (
    <div
      data-testid="start-run-dialog"
      role="dialog"
      aria-label="Start Run"
      aria-modal="true"
    >
      {/* Overlay backdrop — click to close (when not busy) */}
      <div
        className="settings-overlay"
        onClick={handleClose}
        style={{ animation: "fadeIn 250ms ease forwards" }}
      >
        {/* Panel content */}
        <div
          className="settings-panel"
          onClick={(e) => e.stopPropagation()}
          style={{
            animation: "slideIn 400ms ease forwards",
            maxWidth: "520px",
            width: "90%",
          }}
        >
          {/* Header */}
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

          {/* Phase indicator */}
          <div style={{
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: phaseColor(phase),
            marginBottom: "16px",
            padding: "4px 8px",
            borderRadius: "4px",
            backgroundColor: `${phaseColor(phase)}18`,
            display: "inline-block",
          }}>
            {phaseLabel(phase)}
          </div>

          {/* Issue ID input */}
          <form onSubmit={handleScout} style={{ marginBottom: "20px" }}>
            <label
              htmlFor="start-run-issue-id"
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: 600,
                color: "#b0b0b0",
                marginBottom: "8px",
              }}
            >
              Beads Issue ID
            </label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                ref={inputRef}
                id="start-run-issue-id"
                type="text"
                className="command-bar-input"
                placeholder="e.g. bd-42"
                value={issueId}
                onChange={(e) => setIssueId(e.target.value)}
                disabled={phase === "scouting" || phase === "implementing"}
                aria-label="Beads issue ID"
                autoComplete="off"
                style={{ flex: 1 }}
              />
              <button
                type="submit"
                className="command-bar-submit"
                disabled={
                  phase === "scouting" ||
                  phase === "implementing" ||
                  !issueId.trim()
                }
                aria-label="Scout issue"
              >
                {phase === "scouting" ? "Scouting..." : "Scout Issue"}
              </button>
            </div>
            <p style={{
              fontSize: "11px",
              color: "#7a8a9e",
              marginTop: "8px",
              marginBottom: 0,
            }}>
              Enter a Beads issue ID to have the Oracle scout assess it.
            </p>
          </form>

          {/* Scout error */}
          {scoutError && phase === "error" && (
            <div
              style={{
                padding: "12px",
                borderRadius: "8px",
                backgroundColor: `${colors.danger}18`,
                border: `1px solid ${colors.danger}44`,
                color: colors.danger,
                fontSize: "13px",
                marginBottom: "16px",
              }}
            >
              <strong>Scout Error:</strong> {scoutError}
            </div>
          )}

          {/* Scout result / assessment */}
          {scoutResult && phase === "complete" && (
            <div
              style={{
                padding: "16px",
                borderRadius: "8px",
                backgroundColor: `${colors.success}10`,
                border: `1px solid ${colors.success}33`,
                marginBottom: "16px",
              }}
            >
              <div style={{
                fontSize: "13px",
                fontWeight: 600,
                color: colors.success,
                marginBottom: "8px",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}>
                Scout Assessment Complete
              </div>
              <div style={{
                fontSize: "13px",
                color: "#d0d0d0",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}>
                {scoutResult.assessment || scoutResult.message || "No assessment details provided."}
              </div>
            </div>
          )}

          {/* Implement error */}
          {implementError && (
            <div
              style={{
                padding: "12px",
                borderRadius: "8px",
                backgroundColor: `${colors.danger}18`,
                border: `1px solid ${colors.danger}44`,
                color: colors.danger,
                fontSize: "13px",
                marginBottom: "16px",
              }}
            >
              <strong>Implement Error:</strong> {implementError}
            </div>
          )}

          {/* Action buttons */}
          <div style={{
            display: "flex",
            gap: "12px",
            justifyContent: "flex-end",
            marginTop: "8px",
          }}>
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
                border: `1px solid #4a5a6e`,
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
