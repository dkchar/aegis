import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopBar } from "../top-bar";
import type { DashboardState } from "../../types/dashboard-state";

function makeState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    status: { mode: "conversational", isRunning: true, uptimeSeconds: 3661, activeAgents: 2, queueDepth: 3, paused: false },
    spend: { metering: "exact_usd", totalInputTokens: 1000, totalOutputTokens: 500 },
    agents: [],
    ...overrides,
  };
}

describe("TopBar", () => {
  const defaultProps = {
    state: makeState(),
    isConnected: true,
    onAutoToggle: vi.fn(),
    onSettingsOpen: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Olympus title", () => {
    const { container } = render(<TopBar {...defaultProps} />);
    expect(container.querySelector(".top-bar-title")?.textContent).toBe("Olympus");
  });

  it("shows running status when isRunning is true", () => {
    const { container } = render(<TopBar {...defaultProps} />);
    expect(container.textContent).toContain("Running");
  });

  it("shows stopped status when isRunning is false", () => {
    const { container } = render(<TopBar {...defaultProps} state={makeState({ status: { ...makeState().status, isRunning: false } })} />);
    expect(container.textContent).toContain("Stopped");
  });

  it("shows active agent count", () => {
    const { container } = render(<TopBar {...defaultProps} state={makeState({ status: { ...makeState().status, activeAgents: 5 } })} />);
    expect(container.textContent).toContain("5");
  });

  it("shows queue depth", () => {
    const { container } = render(<TopBar {...defaultProps} state={makeState({ status: { ...makeState().status, queueDepth: 7 } })} />);
    expect(container.textContent).toContain("7");
  });

  it("shows uptime in HH:MM:SS format", () => {
    const { container } = render(<TopBar {...defaultProps} state={makeState({ status: { ...makeState().status, uptimeSeconds: 3661 } })} />);
    expect(container.textContent).toContain("01:01:01");
  });

  it("displays spend in USD for exact_usd metering", () => {
    const { container } = render(<TopBar {...defaultProps} state={makeState({
      spend: { metering: "exact_usd", costUsd: 1.50, totalInputTokens: 1000, totalOutputTokens: 500 },
    })} />);
    expect(container.textContent).toContain("$1.50");
  });

  it("displays quota percentage for quota metering", () => {
    const { container } = render(<TopBar {...defaultProps} state={makeState({
      spend: { metering: "quota", quotaUsedPct: 45, totalInputTokens: 1000, totalOutputTokens: 500 },
    })} />);
    expect(container.textContent).toContain("45%");
  });

  it("displays token count for stats_only metering", () => {
    const { container } = render(<TopBar {...defaultProps} state={makeState({
      spend: { metering: "stats_only", totalInputTokens: 5000, totalOutputTokens: 3000 },
    })} />);
    expect(container.textContent).toContain("8,000");
  });

  it("displays N/A for unknown metering with no data", () => {
    const { container } = render(<TopBar {...defaultProps} state={makeState({
      spend: { metering: "unknown", totalInputTokens: 0, totalOutputTokens: 0 },
    })} />);
    expect(container.textContent).toContain("N/A");
  });

  it("shows OFF button when not in auto mode", () => {
    const { container } = render(<TopBar {...defaultProps} />);
    const btn = container.querySelector(".auto-toggle-btn.off");
    expect(btn).toBeTruthy();
    expect(btn?.textContent).toBe("OFF");
  });

  it("shows ON button when in auto mode", () => {
    const { container } = render(<TopBar {...defaultProps} state={makeState({ status: { ...makeState().status, mode: "auto" } })} />);
    const btn = container.querySelector(".auto-toggle-btn.on");
    expect(btn).toBeTruthy();
    expect(btn?.textContent).toBe("ON");
  });

  it("calls onAutoToggle when auto button is clicked", () => {
    const onAutoToggle = vi.fn();
    const { container } = render(<TopBar {...defaultProps} onAutoToggle={onAutoToggle} />);
    const btn = container.querySelector(".auto-toggle-btn");
    btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onAutoToggle).toHaveBeenCalledWith(true);
  });

  it("calls onSettingsOpen when settings button is clicked", () => {
    const onSettingsOpen = vi.fn();
    const { container } = render(<TopBar {...defaultProps} onSettingsOpen={onSettingsOpen} />);
    const btn = container.querySelector(".settings-btn");
    btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSettingsOpen).toHaveBeenCalledOnce();
  });

  it("shows disconnected status when not connected", () => {
    const { container } = render(<TopBar {...defaultProps} isConnected={false} />);
    expect(container.querySelector(".status-dot.disconnected")).toBeTruthy();
  });
});
