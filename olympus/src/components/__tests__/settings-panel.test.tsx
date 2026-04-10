import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsPanel } from "../settings-panel";

describe("SettingsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders when isOpen is true", () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    expect(container.textContent).toContain("Settings");
  });

  it("uses the visible overlay as the accessible dialog root", () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    const overlay = container.querySelector(".settings-overlay");

    expect(overlay).toBeTruthy();
    expect(overlay).toBe(container.querySelector('[data-testid="settings-panel"]'));
    expect(overlay?.getAttribute("role")).toBe("dialog");
    expect(overlay?.getAttribute("aria-label")).toBe("Settings");
    expect(overlay?.getAttribute("aria-modal")).toBe("true");
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(<SettingsPanel isOpen={false} onClose={vi.fn()} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const closeBtn = container.querySelector(".settings-close-btn");
    closeBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when overlay is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const overlay = container.querySelector(".settings-overlay");
    overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not close when panel content is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const panel = container.querySelector(".settings-panel");
    panel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("displays runtime configuration", () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain("Runtime");
  });

  it("displays concurrency configuration", () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain("Concurrency");
  });

  it("displays budget configuration", () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain("Budget");
  });

  it("renders editable concurrency and per-caste budget controls", async () => {
    render(
      <SettingsPanel
        isOpen={true}
        onClose={vi.fn()}
        loadConfig={vi.fn().mockResolvedValue({
          concurrency: {
            max_agents: 3,
            max_oracles: 2,
            max_titans: 3,
            max_sentinels: 1,
            max_janus: 1,
          },
          budgets: {
            oracle: { turns: 10, tokens: 80_000 },
            titan: { turns: 20, tokens: 300_000 },
            sentinel: { turns: 8, tokens: 100_000 },
            janus: { turns: 12, tokens: 120_000 },
          },
        })}
        saveConfig={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Max Titans")).toBeTruthy();
    });

    expect(screen.getByLabelText("Max Agents")).toBeTruthy();
    expect(screen.getByLabelText("Max Titans")).toBeTruthy();
    expect(screen.getByLabelText("Oracle Turns")).toBeTruthy();
    expect(screen.getByLabelText("Titan Tokens")).toBeTruthy();
  });

  it("applies the mock-run observation profile and saves the edited config", async () => {
    const saveConfig = vi.fn().mockResolvedValue({
      ok: true,
      message: "Config updated",
    });

    render(
      <SettingsPanel
        isOpen={true}
        onClose={vi.fn()}
        loadConfig={vi.fn().mockResolvedValue({
          concurrency: {
            max_agents: 3,
            max_oracles: 2,
            max_titans: 3,
            max_sentinels: 1,
            max_janus: 1,
          },
          budgets: {
            oracle: { turns: 10, tokens: 80_000 },
            titan: { turns: 20, tokens: 300_000 },
            sentinel: { turns: 8, tokens: 100_000 },
            janus: { turns: 12, tokens: 120_000 },
          },
        })}
        saveConfig={saveConfig}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Apply Mock-Run Observation Profile" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Apply Mock-Run Observation Profile" }));
    expect((screen.getByLabelText("Max Titans") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("Titan Tokens") as HTMLInputElement).value).toBe("2000000");

    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() => {
      expect(saveConfig).toHaveBeenCalledWith({
        concurrency: {
          max_agents: 10,
          max_oracles: 5,
          max_titans: 10,
          max_sentinels: 3,
          max_janus: 2,
        },
        budgets: {
          oracle: { turns: 50, tokens: 500_000 },
          titan: { turns: 100, tokens: 2_000_000 },
          sentinel: { turns: 30, tokens: 500_000 },
          janus: { turns: 50, tokens: 1_000_000 },
        },
      });
    });
  });
});
