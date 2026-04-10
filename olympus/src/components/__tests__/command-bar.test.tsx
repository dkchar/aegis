import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

  it("renders the command input", () => {
    const { container } = render(<CommandBar {...defaultProps} />);
    expect(container.querySelector(".command-bar-input")).toBeTruthy();
  });

  it("renders the submit button", () => {
    const { container } = render(<CommandBar {...defaultProps} />);
    expect(container.querySelector(".command-bar-submit")).toBeTruthy();
  });

  it("renders the quick kill input", () => {
    const { container } = render(<CommandBar {...defaultProps} />);
    const inputs = container.querySelectorAll(".command-bar-input");
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });

  it("renders the quick kill button", () => {
    const { container } = render(<CommandBar {...defaultProps} />);
    expect(container.querySelector(".kill-btn")).toBeTruthy();
  });

  it("disables input when disabled prop is true", () => {
    const { container } = render(<CommandBar {...defaultProps} disabled />);
    expect((container.querySelector(".command-bar-input") as HTMLInputElement).disabled).toBe(true);
  });

  it("disables submit button when disabled prop is true", () => {
    const { container } = render(<CommandBar {...defaultProps} disabled />);
    expect((container.querySelector(".command-bar-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("submits command on Enter key", async () => {
    const onCommand = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<CommandBar {...defaultProps} onCommand={onCommand} />);
    const input = container.querySelector(".command-bar-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "status" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith("status", undefined);
    });
  });

  it("submits command on button click", async () => {
    const onCommand = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<CommandBar {...defaultProps} onCommand={onCommand} />);
    const input = container.querySelector(".command-bar-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "status" } });
    fireEvent.click(container.querySelector(".command-bar-submit")!);

    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith("status", undefined);
    });
  });

  it("delegates command execution without rendering a local results panel", async () => {
    const { container } = render(<CommandBar {...defaultProps} />);
    const input = container.querySelector(".command-bar-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "status" } });
    fireEvent.click(container.querySelector(".command-bar-submit")!);

    await waitFor(() => {
      expect(defaultProps.onCommand).toHaveBeenCalledWith("status", undefined);
    });

    expect(container.querySelector(".command-results")).toBeNull();
  });

  it("calls onKill when kill command is sent", async () => {
    const onKill = vi.fn();
    const { container } = render(<CommandBar {...defaultProps} onKill={onKill} />);
    const input = container.querySelector(".command-bar-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "kill agent-123" } });
    fireEvent.click(container.querySelector(".command-bar-submit")!);

    await waitFor(() => {
      expect(onKill).toHaveBeenCalledWith("agent-123");
    });
  });

  it("does not submit when input is empty", () => {
    const onCommand = vi.fn();
    const { container } = render(<CommandBar {...defaultProps} onCommand={onCommand} />);
    fireEvent.click(container.querySelector(".command-bar-submit")!);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("does not render a clear button because results are owned by the app shell", async () => {
    const { container } = render(<CommandBar {...defaultProps} />);
    const input = container.querySelector(".command-bar-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "status" } });
    fireEvent.click(container.querySelector(".command-bar-submit")!);

    await waitFor(() => {
      expect(defaultProps.onCommand).toHaveBeenCalledWith("status", undefined);
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.some((button) => button.textContent === "Clear")).toBe(false);
  });
});
