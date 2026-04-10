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
    expect(screen.getByTestId("command-bar")).toBeTruthy();
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

  it("keeps Start Run in an error state when scout is declined", async () => {
    setMockReadyIssues(["aegis-aru"]);
    const sendCommand = vi.fn().mockResolvedValue({
      ok: true,
      status: "declined",
      message: "Scout failed for aegis-aru",
      raw: {
        status: "declined",
      },
    });
    setMockUseSse({
      isConnected: true,
      sendCommand,
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Start Run" }));
    await waitFor(() => {
      expect(apiClient.fetchReadyIssues).toHaveBeenCalledOnce();
    });
    fireEvent.change(screen.getByLabelText("Ready issue"), {
      target: { value: "aegis-aru" },
    });
    fireEvent.click(screen.getByLabelText("Scout issue"));

    await waitFor(() => {
      expect(screen.getByText(/Scout Error:/)).toBeTruthy();
    });

    expect(screen.getByText(/Scout failed for aegis-aru/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Proceed to Implement" })).toBeNull();
  });

  it("keeps Start Run open and shows the backend error when implement is declined", async () => {
    setMockReadyIssues(["aegis-cgm"]);
    const sendCommand = vi.fn(async (command: string) => {
      if (command === "scout") {
        return {
          ok: true,
          message: "Scouted aegis-cgm; ready for implementation.",
          raw: {
            assessment: "Oracle says this issue is ready.",
          },
        };
      }

      return {
        ok: true,
        status: "declined",
        message: "Implementation failed for aegis-cgm",
        raw: {
          status: "declined",
        },
      };
    });
    setMockUseSse({
      isConnected: true,
      sendCommand,
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Start Run" }));
    await waitFor(() => {
      expect(apiClient.fetchReadyIssues).toHaveBeenCalledOnce();
    });
    fireEvent.change(screen.getByLabelText("Ready issue"), {
      target: { value: "aegis-cgm" },
    });
    fireEvent.click(screen.getByLabelText("Scout issue"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Proceed to Implement" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Proceed to Implement" }));

    await waitFor(() => {
      expect(screen.getByText(/Implement Error:/)).toBeTruthy();
    });

    expect(screen.getByText(/Implementation failed for aegis-cgm/)).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Start Run" })).toBeTruthy();
  });
});
