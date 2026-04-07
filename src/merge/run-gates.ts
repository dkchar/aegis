/**
 * Mechanical gate runner — S14 implementation.
 *
 * SPECv2 §12.6–§12.7:
 *   - verification gates run before any merge attempt
 *   - gate categories: tests, lint, build, optional repo-specific scripts
 *   - gates are configurable policy, not hardcoded toolchain assumptions
 *   - gate results determine whether merge proceeds, fails, or requires rework
 */

import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Gate configuration
// ---------------------------------------------------------------------------

/** A single verification gate. */
export interface GateDefinition {
  /** Human-readable name for the gate (e.g. "tests", "lint", "build"). */
  name: string;

  /** Command to execute. */
  command: string;

  /** Arguments to pass to the command. */
  args: readonly string[];

  /** Working directory for execution. */
  cwd: string;

  /** Timeout in milliseconds. */
  timeoutMs: number;

  /** Whether failure of this gate is fatal (stops the merge) or advisory. */
  isFatal: boolean;
}

/** Configuration for the mechanical gate runner. */
export interface GateRunnerConfig {
  /** Ordered list of gates to run. */
  gates: readonly GateDefinition[];

  /** Project root for artifact writes. */
  projectRoot: string;
}

// ---------------------------------------------------------------------------
// Gate results
// ---------------------------------------------------------------------------

/** Result of a single gate execution. */
export interface GateResult {
  /** The gate name this result corresponds to. */
  name: string;

  /** Whether the gate passed. */
  passed: boolean;

  /** Exit code from the gate command (null if the gate could not be executed). */
  exitCode: number | null;

  /** Captured stdout from the gate command. */
  stdout: string;

  /** Captured stderr from the gate command. */
  stderr: string;

  /** Wall time in milliseconds for gate execution. */
  durationMs: number;

  /** Optional error message if the gate could not be executed. */
  error?: string;
}

/** Overall result of running all gates. */
export interface GatesRunResult {
  /** Whether ALL fatal gates passed. */
  allFatalPassed: boolean;

  /** Individual gate results in execution order. */
  results: readonly GateResult[];

  /** Whether any non-fatal gate failed (advisory only). */
  anyAdvisoryFailure: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a single gate and capture its result.
 */
function runSingleGate(gate: GateDefinition): GateResult {
  const startTime = Date.now();

  try {
    const result = spawnSync(gate.command, gate.args, {
      cwd: gate.cwd,
      timeout: gate.timeoutMs,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10 MB buffer for output
      windowsHide: true,
    });

    const durationMs = Date.now() - startTime;
    const stdout = (result.stdout ?? "").trim();
    const stderr = (result.stderr ?? "").trim();
    const exitCode = result.status;
    const passed = exitCode === 0;

    return {
      name: gate.name,
      passed,
      exitCode,
      stdout,
      stderr,
      durationMs,
      error: result.error?.message,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    return {
      name: gate.name,
      passed: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs,
      error: (err as Error).message,
    };
  }
}

/**
 * Run all configured verification gates against the candidate branch.
 *
 * Gates run in the order specified in config.gates. Execution continues
 * through all gates — results are collected for every gate.
 *
 * @param config - Gate runner configuration.
 * @returns Result of running all gates.
 */
export async function runGates(config: GateRunnerConfig): Promise<GatesRunResult> {
  const results: GateResult[] = [];

  for (const gate of config.gates) {
    const result = runSingleGate(gate);
    results.push(result);
  }

  const allFatalPassed = results
    .filter((_, i) => config.gates[i].isFatal)
    .every((r) => r.passed);

  const anyAdvisoryFailure = results
    .filter((_, i) => !config.gates[i].isFatal)
    .some((r) => !r.passed);

  return {
    allFatalPassed,
    results,
    anyAdvisoryFailure,
  };
}

/**
 * Build the default gate configuration for a project.
 *
 * Returns the canonical MVP gate set: tests, lint, build.
 * Repository-specific verification scripts can be appended by the caller.
 *
 * @param projectRoot - Absolute path to the project root.
 * @param candidateCwd - Working directory for the candidate (typically the labor path).
 * @returns Default gate configuration.
 */
export function defaultGateConfig(
  projectRoot: string,
  candidateCwd: string,
): GateRunnerConfig {
  return {
    gates: [
      {
        name: "lint",
        command: "npm",
        args: ["run", "lint"],
        cwd: candidateCwd,
        timeoutMs: 120_000,
        isFatal: true,
      },
      {
        name: "build",
        command: "npm",
        args: ["run", "build"],
        cwd: candidateCwd,
        timeoutMs: 120_000,
        isFatal: true,
      },
      {
        name: "tests",
        command: "npm",
        args: ["run", "test"],
        cwd: candidateCwd,
        timeoutMs: 300_000,
        isFatal: true,
      },
    ],
    projectRoot,
  };
}
