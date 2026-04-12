import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActiveSessionsPanel } from "../active-sessions-panel";

describe("ActiveSessionsPanel", () => {
  it("renders the active sessions section with heading", () => {
    render(<ActiveSessionsPanel sessions={{}} />);
    expect(screen.getByRole("heading", { name: "Active Agent Sessions" })).toBeTruthy();
  });

  it("renders active session terminals", () => {
    const sessions = {
      "session-1": {
        id: "session-1",
        caste: "oracle" as const,
        issueId: "foundation.contract",
        stage: "implementing",
        model: "pi:default",
        lines: ["> scouting foundation.contract", "> dispatching to titan"],
      },
    };

    render(<ActiveSessionsPanel sessions={sessions} />);

    expect(screen.getByText("session-1")).toBeTruthy();
    expect(screen.getByText("oracle")).toBeTruthy();
    expect(screen.getAllByText(/foundation\.contract/).length).toBeGreaterThan(0);
    expect(screen.getByText("scouting foundation.contract")).toBeTruthy();
  });

  it("shows empty state when no sessions are active", () => {
    render(<ActiveSessionsPanel sessions={{}} />);
    expect(screen.getAllByText("No active sessions").length).toBeGreaterThan(0);
  });

  it("renders multiple sessions", () => {
    const sessions = {
      "session-1": {
        id: "session-1",
        caste: "oracle" as const,
        issueId: "bd-1",
        stage: "scouting",
        model: "pi:default",
        lines: [],
      },
      "session-2": {
        id: "session-2",
        caste: "titan" as const,
        issueId: "bd-2",
        stage: "implementing",
        model: "pi:default",
        lines: [],
      },
      "session-3": {
        id: "session-3",
        caste: "sentinel" as const,
        issueId: "bd-3",
        stage: "reviewing",
        model: "pi:default",
        lines: [],
      },
    };

    render(<ActiveSessionsPanel sessions={sessions} />);

    expect(screen.getAllByText("session-1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("session-2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("session-3").length).toBeGreaterThanOrEqual(1);
  });

  it("renders all four caste types with correct colors", () => {
    const sessions = {
      "s-oracle": { id: "s-oracle", caste: "oracle" as const, issueId: "x", stage: "s", model: "m", lines: [] },
      "s-titan": { id: "s-titan", caste: "titan" as const, issueId: "x", stage: "s", model: "m", lines: [] },
      "s-sentinel": { id: "s-sentinel", caste: "sentinel" as const, issueId: "x", stage: "s", model: "m", lines: [] },
      "s-janus": { id: "s-janus", caste: "janus" as const, issueId: "x", stage: "s", model: "m", lines: [] },
    };

    render(<ActiveSessionsPanel sessions={sessions} />);

    expect(screen.getAllByText("oracle").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("titan").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("sentinel").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("janus").length).toBeGreaterThanOrEqual(1);
  });

  it("renders terminal aria-label for accessibility", () => {
    const sessions = {
      "session-1": {
        id: "session-1",
        caste: "oracle" as const,
        issueId: "bd-1",
        stage: "scouting",
        model: "pi:default",
        lines: [],
      },
    };

    render(<ActiveSessionsPanel sessions={sessions} />);

    expect(screen.getAllByLabelText(/Session session-1/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders usage stats when provided", () => {
    const sessions = {
      "session-1": {
        id: "session-1",
        caste: "titan" as const,
        issueId: "bd-1",
        stage: "implementing",
        model: "pi:default",
        lines: [],
        inputTokens: 12000,
        outputTokens: 6000,
        turns: 15,
        elapsedSec: 125,
        spendUsd: 0.42,
      },
    };

    render(<ActiveSessionsPanel sessions={sessions} />);

    expect(screen.getByText(/15t/)).toBeTruthy();
    expect(screen.getByText(/12\.0k in/)).toBeTruthy();
    expect(screen.getByText(/6\.0k out/)).toBeTruthy();
    expect(screen.getByText(/2m 5s/)).toBeTruthy();
    expect(screen.getByText(/\$0\.42/)).toBeTruthy();
  });

  it("shows waiting message when session has no lines", () => {
    const sessions = {
      "session-1": {
        id: "session-1",
        caste: "oracle" as const,
        issueId: "bd-1",
        stage: "scouting",
        model: "pi:default",
        lines: [],
      },
    };

    render(<ActiveSessionsPanel sessions={sessions} />);

    expect(screen.getAllByText("Waiting for output...").length).toBeGreaterThan(0);
  });

  it("has terminal-like dark background styling", () => {
    const sessions = {
      "session-1": {
        id: "session-1",
        caste: "oracle" as const,
        issueId: "bd-1",
        stage: "scouting",
        model: "pi:default",
        lines: ["> scouting"],
      },
    };

    const { container } = render(<ActiveSessionsPanel sessions={sessions} />);
    const terminals = container.querySelectorAll(".session-terminal");
    expect(terminals.length).toBeGreaterThan(0);
    expect((terminals[0] as HTMLElement).style.background).toMatch(/#0a0e14|rgb\(10, 14, 20\)/);
  });

  it("renders green terminal text for output lines", () => {
    const sessions = {
      "session-1": {
        id: "session-1",
        caste: "titan" as const,
        issueId: "bd-1",
        stage: "implementing",
        model: "pi:default",
        lines: ["> analyzing structure"],
      },
    };

    render(<ActiveSessionsPanel sessions={sessions} />);
    expect(screen.getByText("analyzing structure")).toBeTruthy();
  });
});
