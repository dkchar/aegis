/**
 * Metric display component.
 *
 * Reusable metric card with label, value, unit, icon, color variant,
 * and optional tooltip. Used throughout the dashboard for spend/quota,
 * queue depth, uptime, and other dashboard metrics.
 */

import type { JSX } from "react";
import { colors } from "../theme/tokens";

export interface MetricDisplayProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: string;
  variant?: "default" | "success" | "warning" | "danger" | "info";
  tooltip?: string;
}

type Variant = NonNullable<MetricDisplayProps["variant"]>;

const variantColorMap: Record<Variant, string> = {
  default: colors.textPrimary,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  info: colors.info,
};

export function MetricDisplay(props: MetricDisplayProps): JSX.Element {
  const { label, value, unit, icon, variant = "default", tooltip } = props;

  const valueColor = variantColorMap[variant] ?? colors.textPrimary;

  return (
    <div
      data-testid="metric-display"
      className="metric-display"
      title={tooltip}
    >
      <div className="metric-badge">
        {icon && (
          <span
            className="metric-badge-icon"
            aria-hidden="true"
            style={{ fontSize: "16px", marginBottom: "2px" }}
          >
            {icon}
          </span>
        )}
        <span className="metric-badge-label">{label}</span>
        <span
          className={`metric-badge-value ${variant !== "default" ? variant : ""}`}
          style={variant === "default" ? { color: valueColor } : undefined}
        >
          {value}
          {unit && (
            <span className="metric-badge-unit" style={{ marginLeft: "4px", fontSize: "12px", color: colors.textMuted }}>
              {unit}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
