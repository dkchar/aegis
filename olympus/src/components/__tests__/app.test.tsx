import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../../App";
import * as apiClient from "../../lib/api-client";
import * as useSseModule from "../../lib/use-sse";

vi.mock("../../lib/use-sse", () => ({
  useSse: vi.fn(),
}));

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

function buildBaseState(overrides: Record<string, unknown> = {}) {
  return {
    status: {
      mode: "conversational" as const,
      isRunning: true,
      uptimeSeconds: 12,
      activeAgents: 0,
      queueDepth: 0,
      paused: false,
      autoLoopEnabled: false,
      ...((overrides.status as Record<string, unknown>) ?? {}),
    },
    spend: {
      metering: "unknown" as const,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      ...((overrides.spend as Record<string, unknown>) ?? {}),
    },
    agents: [],
    ...overrides,
  };
}

function getMetricText(label: string): string {
  const metric = screen.getByText(label).closest('[data-testid="metric-display"]');
  return metric?.textContent ?? "";
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

  it("renders the approved section order", () => {
    setMockUseSse({ isConnected: true });
    render(<App />);

    const headings = screen.getAllByRole("heading").map((node) => node.textContent);
    const canonical = headings.filter((heading) =>
      ["Aegis Loop", "Merge Queue", "Active Agent Sessions", "Completed Sessions"].includes(heading ?? ""),
    );
    expect(canonical).toEqual([
      "Aegis Loop",
      "Merge Queue",
      "Active Agent Sessions",
      "Completed Sessions",
    ]);
  });

  it("does not render the legacy Start Run dialog or conflicting auto toggle flow", () => {
    setMockUseSse({ isConnected: true });
    render(<App />);
    expect(screen.queryByText("Start Run")).toBeNull();
  });

  it("hydrates the sidebar issue graph from ready queue data", async () => {
    setMockUseSse({ isConnected: true });
    setMockReadyIssues(["foundation.contract"]);

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByText("No graph data")).toBeNull();
      expect(screen.getByText("Selected Issue")).toBeTruthy();
      expect(screen.getByText("Stage: ready")).toBeTruthy();
    });
  });

  it("uses live ready queue and active sessions when top-bar counters lag", async () => {
    setMockReadyIssues(["foundation.contract", "merge.queue"]);

    setMockUseSse({
      isConnected: true,
      state: buildBaseState({
        status: {
          activeAgents: 0,
          queueDepth: 0,
        },
        sessions: {
          active: {
            session_a: {
              id: "session_a",
              caste: "titan",
              issueId: "bd-live",
              stage: "implementing",
              model: "pi:default",
              lines: [],
            },
            session_b: {
              id: "session_b",
              caste: "oracle",
              issueId: "bd-aux",
              stage: "scouting",
              model: "pi:default",
              lines: [],
            },
          },
          recent: [],
        },
        mergeQueue: {
          items: [
            { issueId: "bd-merge", status: "queued", attemptCount: 1, lastError: null },
          ],
          logs: [],
        },
      }),
    });

    render(<App />);

    await waitFor(() => {
      expect(getMetricText("Queue")).toContain("2");
      expect(getMetricText("Agents")).toContain("2");
    });
  });

  it("builds the sidebar graph from ready issues, merge queue items, active sessions, and recent sessions", async () => {
    setMockReadyIssues(["foundation.contract"]);

    setMockUseSse({
      isConnected: true,
      state: buildBaseState({
        sessions: {
          active: {
            session_a: {
              id: "session_a",
              caste: "titan",
              issueId: "bd-active",
              stage: "implementing",
              model: "pi:default",
              lines: ["working"],
            },
          },
          recent: [
            {
              id: "session_b",
              caste: "oracle",
              issueId: "bd-recent",
              outcome: "completed",
              endedAt: new Date().toISOString(),
            },
          ],
        },
        mergeQueue: {
          items: [
            { issueId: "bd-merge", status: "queued", attemptCount: 1, lastError: null },
          ],
          logs: [],
        },
      }),
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByText("No graph data")).toBeNull();
      expect(screen.getByText("bd-active - active: implementing")).toBeTruthy();
      expect(screen.getByText("bd-merge - merge: queued")).toBeTruthy();
      expect(screen.getByText("bd-recent - recent: completed")).toBeTruthy();
      expect(screen.getByText("foundation.contract - ready")).toBeTruthy();
    });
  });

  it("selects the active session issue before a ready issue", async () => {
    setMockReadyIssues(["foundation.contract"]);

    setMockUseSse({
      isConnected: true,
      state: buildBaseState({
        sessions: {
          active: {
            session_a: {
              id: "session_a",
              caste: "titan",
              issueId: "bd-active",
              stage: "implementing",
              model: "pi:default",
              lines: ["working"],
            },
          },
          recent: [],
        },
      }),
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Selected Issue")).toBeTruthy();
      expect(screen.getByText("bd-active")).toBeTruthy();
      expect(screen.getByText("Stage: implementing")).toBeTruthy();
    });
  });
});
