/**
 * Mechanical gate runner — unit tests.
 *
 * SPECv2 §12.6–§12.7: verification gates run before merge, configurable policy,
 * fatal vs advisory gates, result collection.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  runGates,
  defaultGateConfig,
  type GateDefinition,
  type GateRunnerConfig,
} from "../../../src/merge/run-gates.js";

let testDir: string;
let candidateDir: string;

beforeEach(() => {
  testDir = join(process.cwd(), ".aegis-test-" + randomUUID());
  candidateDir = join(testDir, "candidate");
  mkdirSync(candidateDir, { recursive: true });

  // Create minimal package.json so npm commands don't fail
  writeFileSync(
    join(candidateDir, "package.json"),
    JSON.stringify({ name: "test-candidate", scripts: {} }),
  );
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGate(overrides: Partial<GateDefinition> = {}): GateDefinition {
  return {
    name: overrides.name ?? "test-gate",
    command: overrides.command ?? "node",
    args: overrides.args ?? ["--version"],
    cwd: overrides.cwd ?? candidateDir,
    timeoutMs: overrides.timeoutMs ?? 10_000,
    isFatal: overrides.isFatal ?? true,
  };
}

function makeConfig(overrides: Partial<GateRunnerConfig> = {}): GateRunnerConfig {
  return {
    gates: overrides.gates ?? [makeGate()],
    projectRoot: overrides.projectRoot ?? testDir,
  };
}

// ---------------------------------------------------------------------------
// runGates
// ---------------------------------------------------------------------------

describe("runGates", () => {
  it("runs a single passing gate", async () => {
    const config = makeConfig({
      gates: [
        makeGate({
          name: "pass-gate",
          command: "node",
          args: ["--version"],
        }),
      ],
    });

    const result = await runGates(config);

    expect(result.allFatalPassed).toBe(true);
    expect(result.anyAdvisoryFailure).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe("pass-gate");
    expect(result.results[0].passed).toBe(true);
    expect(result.results[0].exitCode).toBe(0);
    expect(result.results[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("runs a single failing gate", async () => {
    const config = makeConfig({
      gates: [
        makeGate({
          name: "fail-gate",
          command: "node",
          args: ["-e", "process.exit(1)"],
        }),
      ],
    });

    const result = await runGates(config);

    expect(result.allFatalPassed).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].passed).toBe(false);
    expect(result.results[0].exitCode).toBe(1);
  });

  it("runs multiple gates in order", async () => {
    const config = makeConfig({
      gates: [
        makeGate({ name: "first", command: "node", args: ["--version"] }),
        makeGate({ name: "second", command: "node", args: ["--version"] }),
        makeGate({ name: "third", command: "node", args: ["--version"] }),
      ],
    });

    const result = await runGates(config);

    expect(result.results).toHaveLength(3);
    expect(result.results[0].name).toBe("first");
    expect(result.results[1].name).toBe("second");
    expect(result.results[2].name).toBe("third");
    expect(result.results.every((r) => r.passed)).toBe(true);
    expect(result.allFatalPassed).toBe(true);
  });

  it("records fatal gate failures but continues execution", async () => {
    const config = makeConfig({
      gates: [
        makeGate({ name: "pass-1", command: "node", args: ["--version"] }),
        makeGate({ name: "fail-1", command: "node", args: ["-e", "process.exit(1)"] }),
        makeGate({ name: "pass-2", command: "node", args: ["--version"] }),
      ],
    });

    const result = await runGates(config);

    expect(result.results).toHaveLength(3);
    expect(result.results[0].passed).toBe(true);
    expect(result.results[1].passed).toBe(false);
    expect(result.results[2].passed).toBe(true);
    // All fatal gates did not pass
    expect(result.allFatalPassed).toBe(false);
  });

  it("distinguishes fatal from advisory gate failures", async () => {
    const config = makeConfig({
      gates: [
        makeGate({ name: "fatal-fail", command: "node", args: ["-e", "process.exit(1)"], isFatal: true }),
        makeGate({ name: "advisory-fail", command: "node", args: ["-e", "process.exit(1)"], isFatal: false }),
        makeGate({ name: "advisory-pass", command: "node", args: ["--version"], isFatal: false }),
      ],
    });

    const result = await runGates(config);

    expect(result.allFatalPassed).toBe(false);
    expect(result.anyAdvisoryFailure).toBe(true);
  });

  it("reports advisory failures separately from fatal", async () => {
    const config = makeConfig({
      gates: [
        makeGate({ name: "fatal-pass", command: "node", args: ["--version"], isFatal: true }),
        makeGate({ name: "advisory-fail", command: "node", args: ["-e", "process.exit(1)"], isFatal: false }),
      ],
    });

    const result = await runGates(config);

    // All fatal passed, but advisory failed
    expect(result.allFatalPassed).toBe(true);
    expect(result.anyAdvisoryFailure).toBe(true);
  });

  it("handles non-existent command gracefully", async () => {
    const config = makeConfig({
      gates: [
        makeGate({
          name: "no-such-cmd",
          command: "nonexistent-command-xyz",
          args: [],
        }),
      ],
    });

    const result = await runGates(config);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].passed).toBe(false);
    expect(result.results[0].exitCode).toBeNull();
    expect(result.results[0].error).toBeDefined();
  });

  it("captures stdout and stderr", async () => {
    const config = makeConfig({
      gates: [
        makeGate({
          name: "echo-gate",
          command: "node",
          args: ["-e", "console.log('hello-stdout'); console.error('hello-stderr');"],
        }),
      ],
    });

    const result = await runGates(config);

    expect(result.results[0].stdout).toContain("hello-stdout");
    expect(result.results[0].stderr).toContain("hello-stderr");
  });

  it("records duration for each gate", async () => {
    const config = makeConfig({
      gates: [
        makeGate({
          name: "slow-gate",
          command: "node",
          args: ["-e", "setTimeout(() => {}, 50)"],
        }),
      ],
    });

    const result = await runGates(config);

    expect(result.results[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns empty results for empty gate list", async () => {
    const config = makeConfig({ gates: [] });
    const result = await runGates(config);

    expect(result.results).toHaveLength(0);
    expect(result.allFatalPassed).toBe(true); // vacuously true
    expect(result.anyAdvisoryFailure).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// defaultGateConfig
// ---------------------------------------------------------------------------

describe("defaultGateConfig", () => {
  it("returns the canonical MVP gate set", () => {
    const config = defaultGateConfig(testDir, candidateDir);

    expect(config.gates).toHaveLength(3);
    expect(config.gates[0].name).toBe("lint");
    expect(config.gates[1].name).toBe("build");
    expect(config.gates[2].name).toBe("tests");
    expect(config.gates.every((g) => g.isFatal)).toBe(true);
    expect(config.projectRoot).toBe(testDir);
  });

  it("uses the provided candidate cwd for gate execution", () => {
    const customCwd = join(testDir, "custom-candidate");
    mkdirSync(customCwd, { recursive: true });

    const config = defaultGateConfig(testDir, customCwd);

    expect(config.gates.every((g) => g.cwd === customCwd)).toBe(true);
  });
});
