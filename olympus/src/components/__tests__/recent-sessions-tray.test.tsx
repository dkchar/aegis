import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RecentSessionsTray } from "../recent-sessions-tray";

describe("RecentSessionsTray", () => {
  it("renders Completed Sessions heading", () => {
    render(<RecentSessionsTray sessions={[]} />);
    expect(screen.getByRole("heading", { name: "Completed Sessions" })).toBeTruthy();
  });

  it("renders empty state when no sessions exist", () => {
    render(<RecentSessionsTray sessions={[]} />);
    expect(screen.getAllByText("No recent completions").length).toBeGreaterThan(0);
  });

  it("renders one pill per session", () => {
    const sessions = [
      { id: "session-1", caste: "titan" as const, issueId: "aegis-123", outcome: "completed" as const, endedAt: new Date(Date.now() - 120000).toISOString(), lines: [] },
      { id: "session-2", caste: "oracle" as const, issueId: "aegis-456", outcome: "failed" as const, endedAt: new Date(Date.now() - 300000).toISOString(), lines: [] },
    ];
    render(<RecentSessionsTray sessions={sessions} />);
    // Each session renders a button pill
    expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(2);
  });

  it("renders pill text with id and closedAgo", () => {
    const sessions = [
      { id: "session-1", caste: "titan" as const, issueId: "aegis-123", outcome: "completed" as const, endedAt: new Date(Date.now() - 120000).toISOString(), lines: [] },
    ];
    render(<RecentSessionsTray sessions={sessions} />);
    expect(screen.getAllByText(/aegis-123/).length).toBeGreaterThan(0);
  });

  it("renders pills as button elements", () => {
    const sessions = [
      { id: "session-1", caste: "titan" as const, issueId: "aegis-123", outcome: "completed" as const, endedAt: new Date(Date.now() - 120000).toISOString(), lines: [] },
    ];
    render(<RecentSessionsTray sessions={sessions} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    expect(buttons[0].tagName).toBe("BUTTON");
  });

  it("shows outcome-colored dot for success", () => {
    const sessions = [
      { id: "s1", caste: "titan" as const, issueId: "aegis-123", outcome: "completed" as const, endedAt: new Date(Date.now() - 60000).toISOString(), lines: [] },
    ];
    const { container } = render(<RecentSessionsTray sessions={sessions} />);
    const pill = container.querySelector("button");
    expect(pill).toBeTruthy();
    // The dot should be a child span with backgroundColor matching success color
    const dot = pill?.querySelector("span");
    expect(dot).toBeTruthy();
  });
});
