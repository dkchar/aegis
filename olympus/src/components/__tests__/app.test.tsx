import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../../App";
import * as useSseModule from "../../lib/use-sse";

// Mock the useSse hook
vi.mock("../../lib/use-sse", () => ({
  useSse: vi.fn(),
}));

// Mock the api-client
vi.mock("../../lib/api-client", () => ({
  sendCommand: vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
  killAgent: vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
  toggleAutoMode: vi.fn().mockResolvedValue({ ok: true }),
  fetchState: vi.fn().mockResolvedValue({}),
  submitLearning: vi.fn().mockResolvedValue({ ok: true }),
}));

// Mock global styles injection
vi.mock("../../theme/global.css", () => ({
  injectGlobalStyles: vi.fn(),
}));

function setMockUseSse(overrides: Record<string, unknown> = {}) {
  vi.mocked(useSseModule.useSse).mockReturnValue({
    state: null,
    isConnected: false,
    error: null,
    reconnect: vi.fn(),
    sendCommand: vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
    ...overrides,
  });
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the top bar", () => {
    setMockUseSse();
    render(<App />);
    expect(screen.getByRole("banner")).toBeTruthy();
  });

  it("renders the app main container", () => {
    setMockUseSse();
    const { container } = render(<App />);
    const main = container.querySelector("main.app-main");
    expect(main).toBeTruthy();
  });

  it("renders the agent grid", () => {
    setMockUseSse();
    render(<App />);
    const grids = screen.getAllByLabelText("Active Agents");
    expect(grids.length).toBeGreaterThan(0);
  });

  it("renders the command bar", () => {
    setMockUseSse();
    render(<App />);
    const regions = screen.getAllByRole("region");
    const hasCommandBar = regions.some((el) => el.getAttribute("aria-label") === "Command Bar");
    expect(hasCommandBar).toBe(true);
  });

  it("shows error banner when useSse returns an error", () => {
    setMockUseSse({ error: "Connection failed" });
    render(<App />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain("Connection failed");
  });

  it("does not show error banner when there is no error", () => {
    setMockUseSse({ error: null });
    const { container } = render(<App />);
    const alerts = container.querySelectorAll('[role="alert"]');
    expect(alerts.length).toBe(0);
  });

  it("passes agents to AgentGrid from state", () => {
    const agents = [
      {
        agentId: "agent-1",
        caste: "titan" as const,
        model: "pi:default",
        issueId: "bd-1",
        stage: "implementing",
        turnCount: 5,
        inputTokens: 1000,
        outputTokens: 500,
        elapsedSeconds: 120,
        spendUsd: 0.50,
      },
    ];
    setMockUseSse({ state: { status: {}, spend: {}, agents } });
    render(<App />);
    expect(screen.getAllByTestId("agent-card").length).toBeGreaterThan(0);
  });

  it("shows empty state when no agents are active", () => {
    setMockUseSse({ state: { status: {}, spend: {}, agents: [] } });
    const { container } = render(<App />);
    // Use querySelector to avoid StrictMode duplication issues
    const emptyText = container.querySelector(".empty-state-text");
    expect(emptyText?.textContent).toBe("No active agents");
  });
});
