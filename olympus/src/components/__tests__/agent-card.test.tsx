import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentCard } from "../agent-card";
import type { AgentCardProps } from "../agent-card";

function makeProps(overrides: Partial<AgentCardProps> = {}): AgentCardProps {
  return {
    agentId: "agent-test-1",
    caste: "titan",
    model: "pi:default",
    issueId: "bd-42",
    stage: "implementing",
    turnCount: 10,
    inputTokens: 5000,
    outputTokens: 3000,
    elapsedSeconds: 120,
    onKill: vi.fn(),
    ...overrides,
  };
}

describe("AgentCard", () => {
  it("renders the caste badge", () => {
    const { container } = render(<AgentCard {...makeProps()} />);
    expect(container.querySelector(".agent-card-caste.titan")?.textContent).toBe("Titan");
  });

  it("renders the agent ID", () => {
    const { container } = render(<AgentCard {...makeProps()} />);
    expect(container.querySelector(".agent-card-id")?.textContent).toContain("agent-test-1");
  });

  it("renders the issue ID", () => {
    const { container } = render(<AgentCard {...makeProps()} />);
    expect(container.textContent).toContain("bd-42");
  });

  it("renders the model name", () => {
    const { container } = render(<AgentCard {...makeProps()} />);
    expect(container.textContent).toContain("pi:default");
  });

  it("renders the stage", () => {
    const { container } = render(<AgentCard {...makeProps()} />);
    expect(container.textContent).toContain("implementing");
  });

  it("renders turn count", () => {
    const { container } = render(<AgentCard {...makeProps()} />);
    expect(container.textContent).toContain("10");
  });

  it("renders token counts with formatting", () => {
    const { container } = render(<AgentCard {...makeProps()} />);
    expect(container.textContent).toContain("5.0K");
    expect(container.textContent).toContain("3.0K");
  });

  it("renders spend when spendUsd is available", () => {
    const { container } = render(<AgentCard {...makeProps({ spendUsd: 1.50 })} />);
    expect(container.textContent).toContain("$1.50");
  });

  it("renders token fallback when spendUsd is undefined", () => {
    const { container } = render(<AgentCard {...makeProps({ spendUsd: undefined })} />);
    expect(container.textContent).toContain("8.0K");
  });

  it("calls onKill when kill button is clicked", () => {
    const onKill = vi.fn();
    const { container } = render(<AgentCard {...makeProps({ onKill })} />);
    const btn = container.querySelector(".kill-btn");
    btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onKill).toHaveBeenCalledWith("agent-test-1");
  });

  it("renders Oracle caste with correct label", () => {
    const { container } = render(<AgentCard {...makeProps({ caste: "oracle" })} />);
    expect(container.querySelector(".agent-card-caste.oracle")?.textContent).toBe("Oracle");
  });

  it("renders Sentinel caste with correct label", () => {
    const { container } = render(<AgentCard {...makeProps({ caste: "sentinel" })} />);
    expect(container.querySelector(".agent-card-caste.sentinel")?.textContent).toBe("Sentinel");
  });

  it("renders Janus caste with correct label", () => {
    const { container } = render(<AgentCard {...makeProps({ caste: "janus" })} />);
    expect(container.querySelector(".agent-card-caste.janus")?.textContent).toBe("Janus");
  });
});
