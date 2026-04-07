import { describe, it, expect } from "vitest";
import { formatDuration, formatTokens, formatCost } from "../agent-card";

describe("formatDuration", () => {
  it("formats zero seconds", () => {
    expect(formatDuration(0)).toBe("00:00");
  });

  it("formats seconds under a minute", () => {
    expect(formatDuration(45)).toBe("00:45");
  });

  it("formats minutes", () => {
    expect(formatDuration(125)).toBe("02:05");
  });

  it("formats just under an hour", () => {
    expect(formatDuration(3599)).toBe("59:59");
  });

  it("formats exactly one hour", () => {
    expect(formatDuration(3600)).toBe("01:00:00");
  });

  it("formats hours, minutes, seconds", () => {
    expect(formatDuration(3661)).toBe("01:01:01");
  });

  it("clamps negative values to zero", () => {
    expect(formatDuration(-10)).toBe("00:00");
  });
});

describe("formatTokens", () => {
  it("formats zero tokens", () => {
    expect(formatTokens(0)).toBe("0");
  });

  it("formats under 1K without suffix", () => {
    expect(formatTokens(999)).toBe("999");
  });

  it("formats exactly 1K", () => {
    expect(formatTokens(1000)).toBe("1.0K");
  });

  it("formats thousands with K suffix", () => {
    expect(formatTokens(15000)).toBe("15.0K");
  });

  it("formats exactly 1M", () => {
    expect(formatTokens(1_000_000)).toBe("1.00M");
  });

  it("formats millions with M suffix", () => {
    expect(formatTokens(2_500_000)).toBe("2.50M");
  });

  it("handles negative values", () => {
    expect(formatTokens(-100)).toBe("0");
  });
});

describe("formatCost", () => {
  it("returns N/A for undefined", () => {
    expect(formatCost(undefined)).toBe("N/A");
  });

  it("returns N/A for negative values", () => {
    expect(formatCost(-1)).toBe("N/A");
  });

  it("formats very small costs with 4 decimals", () => {
    expect(formatCost(0.0001)).toBe("$0.0001");
  });

  it("formats sub-dollar costs with 3 decimals", () => {
    expect(formatCost(0.01)).toBe("$0.010");
  });

  it("formats dollar costs with 2 decimals", () => {
    expect(formatCost(1.0)).toBe("$1.00");
  });

  it("formats larger costs with 2 decimals", () => {
    expect(formatCost(12.5)).toBe("$12.50");
  });
});
