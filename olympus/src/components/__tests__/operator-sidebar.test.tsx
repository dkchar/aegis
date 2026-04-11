import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OperatorSidebar } from "../operator-sidebar";

describe("OperatorSidebar", () => {
  it("renders ready queue, issue graph, selected issue, and steer reference", () => {
    render(
      <OperatorSidebar
        readyQueue={["foundation.contract", "foundation.lane_a"]}
        issueGraph={["todo-system", "foundation", "foundation.contract"]}
        selectedIssue={{ id: "foundation.contract", stage: "implementing", summary: "safe" }}
        steerReference={["status", "pause", "resume", "focus <issue>", "kill <agent>"]}
        onCommand={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getAllByText("Ready Queue").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Issue Graph").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Selected Issue").length).toBeGreaterThan(0);
    expect(screen.getAllByText("focus <issue>").length).toBeGreaterThan(0);
  });

  it("renders empty states gracefully", () => {
    const { container } = render(
      <OperatorSidebar
        readyQueue={[]}
        issueGraph={[]}
        selectedIssue={null}
        steerReference={["status"]}
        onCommand={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(container.querySelector('[aria-label="Operator Sidebar"]')).toBeTruthy();
    expect(screen.getAllByText("Ready Queue").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Issue Graph").length).toBeGreaterThan(0);
    // Selected Issue section should not render when selectedIssue is null
    const sections = container.querySelectorAll('[aria-label="Operator Sidebar"] > section');
    const hasSelectedIssueSection = Array.from(sections).some(
      (s) => s.querySelector("h3")?.textContent === "Selected Issue",
    );
    expect(hasSelectedIssueSection).toBe(false);
  });
});
