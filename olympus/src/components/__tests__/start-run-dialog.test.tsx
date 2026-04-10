import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { StartRunDialog } from "../start-run-dialog";

describe("StartRunDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("loads a ready-issue picker instead of relying on a raw issue-id text field", async () => {
    const loadReadyIssues = vi.fn().mockResolvedValue([
      {
        id: "aegis-8lq",
        title: "Add Start Run button to Olympus for launching scout-implement cycles",
        priority: 1,
      },
      {
        id: "aegis-hnl",
        title: "Olympus dashboard UX bugs from manual QA session",
        priority: 1,
      },
    ]);

    render(
      <StartRunDialog
        isOpen={true}
        onClose={vi.fn()}
        onScout={vi.fn()}
        onImplement={vi.fn()}
        loadReadyIssues={loadReadyIssues}
      />,
    );

    await waitFor(() => {
      expect(loadReadyIssues).toHaveBeenCalledOnce();
    });

    expect(screen.queryByLabelText("Beads issue ID")).toBeNull();

    const picker = screen.getByLabelText("Ready issue");
    const optionTexts = Array.from((picker as HTMLSelectElement).options).map((option) => option.textContent);

    expect(optionTexts).toEqual([
      "Select a ready issue",
      "aegis-8lq — Add Start Run button to Olympus for launching scout-implement cycles",
      "aegis-hnl — Olympus dashboard UX bugs from manual QA session",
    ]);
  });

  it("scouts the selected ready issue and only offers implementation after a successful assessment", async () => {
    const onScout = vi.fn().mockResolvedValue({
      ok: true,
      message: "Ready for implementation.",
      assessment: "Oracle assessment summary",
    });

    render(
      <StartRunDialog
        isOpen={true}
        onClose={vi.fn()}
        onScout={onScout}
        onImplement={vi.fn()}
        loadReadyIssues={vi.fn().mockResolvedValue([
          {
            id: "aegis-8lq",
            title: "Add Start Run button to Olympus for launching scout-implement cycles",
            priority: 1,
          },
        ])}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Ready issue")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Ready issue"), {
      target: { value: "aegis-8lq" },
    });
    fireEvent.click(screen.getByLabelText("Scout issue"));

    await waitFor(() => {
      expect(onScout).toHaveBeenCalledWith("aegis-8lq");
    });

    expect(screen.getByText("Oracle assessment summary")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Proceed to Implement" })).toBeTruthy();
  });
});
