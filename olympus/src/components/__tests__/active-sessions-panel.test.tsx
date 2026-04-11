import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActiveSessionsPanel } from "../active-sessions-panel";

describe("ActiveSessionsPanel", () => {
  it("renders the active sessions section with heading", () => {
    render(
      <ActiveSessionsPanel
        sessions={{}}
      />,
    );

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
    expect(screen.getByText("> scouting foundation.contract")).toBeTruthy();
  });

  it("shows empty state when no sessions are active", () => {
    render(<ActiveSessionsPanel sessions={{}} />);
    expect(screen.getAllByText("No active sessions").length).toBeGreaterThan(0);
  });
});
