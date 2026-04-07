/**
 * Metric display component contract.
 *
 * Lane A implements: reusable metric cards for spend/quota, queue depth,
 * and other dashboard metrics.
 */

import type { JSX } from "react";

export interface MetricDisplayProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: string;
  variant?: "default" | "success" | "warning" | "danger" | "info";
  tooltip?: string;
}

export function MetricDisplay(_props: MetricDisplayProps): JSX.Element {
  // Lane A: implement metric display card
  return (
    <div data-testid="metric-display" className="metric-display">
      {/* Lane A: implement metric content */}
    </div>
  );
}
