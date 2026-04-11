import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../../App";
import * as apiClient from "../../lib/api-client";
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
  fetchReadyIssues: vi.fn().mockResolvedValue([]),
  fetchEditableConfig: vi.fn().mockResolvedValue({}),
  saveEditableConfig: vi.fn().mockResolvedValue({ ok: true, message: "Config updated" }),
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

function setMockReadyIssues(issueIds: string[]) {
  vi.mocked(apiClient.fetchReadyIssues).mockResolvedValue(
    issueIds.map((id) => ({ id, title: `${id} title`, priority: 1 })),
  );
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockReadyIssues([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the top bar", () => {
    setMockUseSse();
    render(<App />);
    expect(screen.getByTestId("top-bar")).toBeTruthy();
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
    expect(screen.getByTestId("command-bar")).toBeTruthy();
  });

  it("renders the aegis loop panel", () => {
    setMockUseSse();
    render(<App />);
    expect(screen.getByRole("region", { name: "Aegis Loop" })).toBeTruthy();
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

  it("shows only one command results surface and uses the backend status message", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      ok: true,
      message: "Status: running, mode conversational, 0 active agents, queue depth 0",
      raw: {},
    });
    setMockUseSse({
      isConnected: true,
      sendCommand,
    });

    render(<App />);

    fireEvent.click(screen.getByLabelText("Submit command"));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("status", undefined);
    });

    const commandResults = screen.getAllByLabelText("Command Results");
    expect(commandResults).toHaveLength(1);
    expect(screen.getByText("Status: running, mode conversational, 0 active agents, queue depth 0")).toBeTruthy();
    expect(screen.queryByText("Command sent successfully")).toBeNull();
  });

  it("does not render the legacy Start Run flow", () => {
    setMockUseSse({ isConnected: true });
    render(<App />);

    expect(screen.queryByText("Start Run")).toBeNull();
  });

  it("renders the approved section order", () => {
    setMockUseSse({ isConnected: true });
    render(<App />);

    const headings = screen.getAllByRole("heading").map((node) => node.textContent);
    expect(headings).toEqual(
      expect.arrayContaining([
        "Aegis Loop",
        "Merge Queue",
        "Active Agent Sessions",
        "Completed Sessions",
      ]),
    );
  });

  it("does not render the legacy Start Run dialog or conflicting auto toggle flow", () => {
    setMockUseSse({ isConnected: true });
    render(<App />);
    expect(screen.queryByText("Start Run")).toBeNull();
  });
});
