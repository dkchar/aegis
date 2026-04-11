import { useState, useCallback } from "react";
import type { JSX } from "react";
import { colors, radius, spacing, fontSizes } from "../theme/tokens";

export interface SteerPanelProps {
  reference: string[];
  onCommand: (command: string) => Promise<void>;
  value?: string;
  onChange?: (value: string) => void;
  result?: string | null;
}

function ResultSurface(props: { result: string | null | undefined }): JSX.Element | null {
  const { result } = props;
  if (!result) return null;

  return (
    <div
      style={{
        marginTop: spacing.sm,
        padding: spacing.sm,
        background: colors.bgTertiary,
        borderRadius: radius.sm,
        fontSize: fontSizes.xs,
        color: colors.textSecondary,
      }}
    >
      {result}
    </div>
  );
}

export function SteerPanel(props: SteerPanelProps): JSX.Element {
  const { reference, onCommand, value: controlledValue, onChange, result } = props;

  const [internalValue, setInternalValue] = useState("");
  const [internalResult, setInternalResult] = useState<string | null>(null);

  const value = controlledValue ?? internalValue;
  const setValue = onChange ?? setInternalValue;
  const displayResult = result ?? internalResult;

  const handleSubmit = useCallback(async () => {
    const cmd = value.trim();
    if (!cmd) return;
    setInternalResult(null);
    try {
      await onCommand(cmd);
      setInternalResult(`OK: ${cmd}`);
    } catch (err) {
      setInternalResult(err instanceof Error ? err.message : "Command failed");
    }
    setValue("");
  }, [value, onCommand, setValue]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <section aria-label="Steer" data-testid="steer-panel">
      <div style={{ display: "flex", gap: spacing.xs }}>
        <input
          aria-label="Steer command"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
          style={{
            flex: 1,
            padding: spacing.sm,
            background: colors.bgTertiary,
            border: `1px solid ${colors.borderDefault}`,
            borderRadius: radius.sm,
            color: colors.textPrimary,
            fontSize: fontSizes.sm,
            outline: "none",
          }}
        />
        <button
          onClick={() => void handleSubmit()}
          disabled={!value.trim()}
          style={{
            padding: `${spacing.xs} ${spacing.sm}`,
            background: colors.primary,
            border: "none",
            borderRadius: radius.sm,
            color: colors.bgPrimary,
            fontWeight: 700,
            fontSize: fontSizes.xs,
            cursor: value.trim() ? "pointer" : "not-allowed",
            opacity: value.trim() ? 1 : 0.5,
          }}
        >
          Send
        </button>
      </div>

      <ul
        aria-label="Steer Reference"
        style={{
          margin: `${spacing.sm} 0 0 0`,
          paddingLeft: spacing.md,
          fontSize: fontSizes.xs,
          color: colors.textMuted,
        }}
      >
        {reference.map((command) => (
          <li key={command}>{command}</li>
        ))}
      </ul>

      <ResultSurface result={displayResult} />
    </section>
  );
}
