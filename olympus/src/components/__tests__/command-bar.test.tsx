import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CommandBar } from "../command-bar";

describe("CommandBar", () => {
  const defaultProps = {
    onCommand: vi.fn().mockResolvedValue(undefined),
    onKill: vi.fn(),
    disabled: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the structured command selector", () => {
    const { container } = render(<CommandBar {...defaultProps} />);
    expect(screen.getByLabelText("Structured command")).toBeTruthy();
  });

  it("renders the submit button", () => {
    const { container } = render(<CommandBar {...defaultProps} />);
    expect(container.querySelector(".command-bar-submit")).toBeTruthy();
  });

  it("keeps structured commands separate from natural-language chat", () => {
    render(<CommandBar {...defaultProps} />);
    expect(screen.getByText("Ask Aegis")).toBeTruthy();
    expect(screen.getByText(/Natural-language Ask mode is not available/i)).toBeTruthy();
  });

  it("renders an issue id field for issue-scoped commands", () => {
    render(<CommandBar {...defaultProps} />);

    fireEvent.change(screen.getByLabelText("Structured command"), {
      target: { value: "scout" },
    });

    expect(screen.getByLabelText("Issue ID")).toBeTruthy();
  });

  it("disables input when disabled prop is true", () => {
    render(<CommandBar {...defaultProps} disabled />);
    expect((screen.getByLabelText("Structured command") as HTMLSelectElement).disabled).toBe(true);
  });

  it("disables submit button when disabled prop is true", () => {
    const { container } = render(<CommandBar {...defaultProps} disabled />);
    expect((container.querySelector(".command-bar-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("submits command on Enter key", async () => {
    const onCommand = vi.fn().mockResolvedValue(undefined);
    render(<CommandBar {...defaultProps} onCommand={onCommand} />);
    const fieldset = screen.getByLabelText("Structured command");
    fireEvent.keyDown(fieldset, { key: "Enter" });

    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith("status", undefined);
    });
  });

  it("submits command on button click", async () => {
    const onCommand = vi.fn().mockResolvedValue(undefined);
    render(<CommandBar {...defaultProps} onCommand={onCommand} />);
    fireEvent.click(screen.getByLabelText("Submit command"));

    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith("status", undefined);
    });
  });

  it("delegates command execution without rendering a local results panel", async () => {
    const { container } = render(<CommandBar {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("Submit command"));

    await waitFor(() => {
      expect(defaultProps.onCommand).toHaveBeenCalledWith("status", undefined);
    });

    expect(container.querySelector(".command-results")).toBeNull();
  });

  it("calls onKill when kill command is sent", async () => {
    const onCommand = vi.fn().mockResolvedValue(undefined);
    render(<CommandBar {...defaultProps} onCommand={onCommand} />);

    fireEvent.change(screen.getByLabelText("Structured command"), {
      target: { value: "kill" },
    });
    fireEvent.change(screen.getByLabelText("Agent ID"), {
      target: { value: "agent-123" },
    });
    fireEvent.click(screen.getByLabelText("Submit command"));

    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith("kill", { agentId: "agent-123" });
    });
  });

  it("does not submit when input is empty", () => {
    const onCommand = vi.fn();
    render(<CommandBar {...defaultProps} onCommand={onCommand} />);
    fireEvent.change(screen.getByLabelText("Structured command"), {
      target: { value: "kill" },
    });
    expect((screen.getByLabelText("Submit command") as HTMLButtonElement).disabled).toBe(true);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("does not render a clear button because results are owned by the app shell", async () => {
    const { container } = render(<CommandBar {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("Submit command"));

    await waitFor(() => {
      expect(defaultProps.onCommand).toHaveBeenCalledWith("status", undefined);
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.some((button) => button.textContent === "Clear")).toBe(false);
  });
});
