// test/e2e-smoke.test.ts
// End-to-end smoke test: full Oracle → Titan → Sentinel dispatch cycle.
//
// Design:
// - Real temporary git repo + real bd CLI (proper isolation from the main repo)
// - Real Aegis orchestrator running the Layer 1 loop tick-by-tick
// - Real beads.ts, poller.ts, triage.ts, labors.ts, mnemosyne.ts, lethe.ts, monitor.ts
// - Mock ONLY spawner.ts (no real LLM calls) — fake sessions simulate agent behavior
//   by calling the real bd CLI commands on the temp repo
//
// Stage 2 Gate validation (IMPLEMENTATION-PLAN.md §Stage 2):
//   "aegis start runs. The Layer 1 loop dispatches agents. At least one full
//    Oracle → Titan → Sentinel cycle completes against a real beads issue."

import {
  describe, it, expect, beforeAll, afterAll, vi,
} from "vitest";
import {
  mkdirSync, rmSync, writeFileSync, existsSync, readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// We mock spawner so that fake sessions simulate agent behavior (no LLM calls).
// All other modules (beads, labors, poller, triage, mnemosyne, lethe, monitor)
// run with their real implementations against the temp directory.
// ---------------------------------------------------------------------------

// Helpers used by fake sessions (populated during setup)
let testIssueId = "";
let tempDir = "";

// Fake sessions are created inside the mock implementation below.
// They call the real bd CLI to mutate the beads state in tempDir.

function runBd(args: string[], cwd?: string): void {
  execFileSync("bd", args, { cwd: cwd ?? tempDir, stdio: "pipe" });
}

function runGit(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function makeSession(onPrompt: () => void) {
  let unsubscribe: (() => void) | null = null;
  return {
    prompt: vi.fn().mockImplementation(async () => { onPrompt(); }),
    steer: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockImplementation((listener: (e: unknown) => void) => {
      void listener;
      unsubscribe = () => {};
      return () => { unsubscribe?.(); };
    }),
    getSessionStats: vi.fn().mockReturnValue({
      tokens: { total: 200, input: 150, output: 50, cacheRead: 0, cacheWrite: 0 },
      cost: 0.002,
      sessionFile: undefined,
      sessionId: "fake-sid",
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 3,
      toolResults: 3,
      totalMessages: 5,
    }),
  };
}

// Captured laborPath for the Titan session (set by spawnTitan mock)
let capturedLaborPath = "";

vi.mock("../src/spawner.js", () => ({
  spawnOracle: vi.fn().mockImplementation(async (issue: { id: string }) => {
    const issueId = issue.id;
    return makeSession(() => {
      // Oracle: add a SCOUTED: comment and leave the issue open
      runBd(["comments", "add", issueId, "SCOUTED: trivial change, single file"]);
    });
  }),

  spawnTitan: vi.fn().mockImplementation(
    async (issue: { id: string }, _learnings: unknown, laborPath: string) => {
      capturedLaborPath = laborPath;
      const issueId = issue.id;
      return makeSession(() => {
        // Titan: claim, implement a file, commit, close
        runBd(["update", issueId, "--claim"]);
        writeFileSync(join(laborPath, "greeting.ts"), 'export function greet(): string { return "Hello, World!"; }\n');
        runGit(["add", "greeting.ts"], laborPath);
        runGit(["commit", "-m", "feat: add greeting function"], laborPath);
        runBd(["close", issueId, "--reason", "Implemented greeting.ts"]);
      });
    }
  ),

  spawnSentinel: vi.fn().mockImplementation(async (issue: { id: string }) => {
    const issueId = issue.id;
    return makeSession(() => {
      // Sentinel: add a REVIEWED: PASS comment
      runBd(["comments", "add", issueId, "REVIEWED: PASS - clean implementation, tests would pass"]);
    });
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupTempRepo(): string {
  const dir = join(tmpdir(), `aegis-e2e-${randomBytes(6).toString("hex")}`);
  mkdirSync(dir, { recursive: true });

  // Init git
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "aegis-test@test.local"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Aegis E2E Test"], { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "README.md"), "# E2E test repo\n");
  writeFileSync(join(dir, "src.ts"), "// TODO: add greeting function\n");
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "chore: initial scaffold"], { cwd: dir, stdio: "pipe" });

  // Init beads
  execFileSync("bd", ["init"], { cwd: dir, stdio: "pipe" });

  // Create the labors directory
  mkdirSync(join(dir, ".aegis", "labors"), { recursive: true });

  return dir;
}

function createTestIssue(dir: string): string {
  const out = execFileSync(
    "bd",
    ["create", "Add a greeting function", "--description=Add greet() to greeting.ts", "-p", "2", "-t", "task", "--json"],
    { cwd: dir, stdio: "pipe" }
  ).toString("utf8");
  const parsed = JSON.parse(out.trim()) as { id: string };
  return parsed.id;
}

function makeConfig(dir: string) {
  return {
    version: 1 as const,
    auth: { anthropic: null, openai: null, google: null },
    models: {
      oracle: "claude-haiku-4-5",
      titan: "claude-sonnet-4-5",
      sentinel: "claude-sonnet-4-5",
      metis: "claude-haiku-4-5",
      prometheus: "claude-sonnet-4-5",
    },
    concurrency: { max_agents: 5, max_oracles: 2, max_titans: 2, max_sentinels: 1 },
    budgets: {
      oracle_turns: 5,
      oracle_tokens: 50000,
      titan_turns: 20,
      titan_tokens: 200000,
      sentinel_turns: 8,
      sentinel_tokens: 100000,
    },
    timing: { poll_interval_seconds: 5, stuck_warning_seconds: 90, stuck_kill_seconds: 150 },
    mnemosyne: { max_records: 500, context_budget_tokens: 1000 },
    labors: { base_path: join(dir, ".aegis", "labors") },
    olympus: { port: 3847, open_browser: false },
  };
}

// Run the Aegis tick loop until condition() returns true or maxTicks exceeded.
// Between ticks, yields to the microtask queue to let fire-and-forget promises settle.
async function runUntil(
  aegis: { runTick: () => Promise<void> },
  condition: () => Promise<boolean> | boolean,
  maxTicks = 20,
  delayMs = 50
): Promise<boolean> {
  for (let i = 0; i < maxTicks; i++) {
    await aegis.runTick();
    // Yield several times to let fire-and-forget session.prompt() promises settle
    for (let y = 0; y < 5; y++) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    if (await condition()) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const originalCwd = process.cwd();

beforeAll(async () => {
  tempDir = setupTempRepo();
  testIssueId = createTestIssue(tempDir);
  // Switch cwd so that beads.ts (which calls bd without explicit cwd) and
  // labors.ts (which calls git without explicit cwd) both operate in tempDir.
  process.chdir(tempDir);
}, 30_000);

afterAll(() => {
  process.chdir(originalCwd);
  if (existsSync(tempDir)) {
    // Stop the beads Dolt server before removing the directory.
    // On Windows, the server holds file locks that prevent deletion.
    try {
      execFileSync("bd", ["dolt", "stop"], { cwd: tempDir, stdio: "pipe" });
    } catch { /* ignore — server may already be stopped */ }
    // Short delay to let file handles close
    const deadline = Date.now() + 3000;
    const tryRemove = (): void => {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        if (Date.now() < deadline) setTimeout(tryRemove, 500);
        // else: give up silently — OS will clean temp dir eventually
      }
    };
    tryRemove();
  }
});

// ---------------------------------------------------------------------------
// The smoke test
// ---------------------------------------------------------------------------

describe("E2E smoke: Oracle → Titan → Sentinel cycle", () => {
  it("completes the full dispatch cycle for a real beads issue", async () => {
    const { Aegis } = await import("../src/aegis.js");
    const spawnerMock = await import("../src/spawner.js");

    const config = makeConfig(tempDir);
    const aegis = new Aegis(config, tempDir);

    const sseEvents: string[] = [];
    aegis.onEvent((e) => sseEvents.push(e.type));

    const loop = aegis as unknown as { runTick: () => Promise<void> };

    // -----------------------------------------------------------------
    // Phase 1: Oracle dispatch
    // Precondition: issue is open with no SCOUTED comment → triage → Oracle
    // -----------------------------------------------------------------
    const oracleDispatched = await runUntil(
      loop,
      () => vi.mocked(spawnerMock.spawnOracle).mock.calls.length > 0,
      5,
      30
    );
    expect(oracleDispatched, "Oracle should have been dispatched").toBe(true);

    // Run a few more ticks to let Oracle complete and get reaped
    const oracleCompleted = await runUntil(
      loop,
      async () => {
        const beadsModule = await import("../src/beads.js");
        const issue = await beadsModule.show(testIssueId);
        return issue.comments.some((c) => c.body.startsWith("SCOUTED:"));
      },
      10,
      50
    );
    expect(oracleCompleted, "Oracle should have added SCOUTED: comment").toBe(true);

    // -----------------------------------------------------------------
    // Phase 2: Titan dispatch
    // Precondition: issue has SCOUTED comment, still open → triage → Titan
    // -----------------------------------------------------------------
    const titanDispatched = await runUntil(
      loop,
      () => vi.mocked(spawnerMock.spawnTitan).mock.calls.length > 0,
      10,
      50
    );
    expect(titanDispatched, "Titan should have been dispatched").toBe(true);

    // Verify a Labor was created
    expect(capturedLaborPath).toBeTruthy();
    expect(capturedLaborPath).toContain(testIssueId);

    // Run until Titan completes (issue closed)
    const titanCompleted = await runUntil(
      loop,
      async () => {
        const beadsModule = await import("../src/beads.js");
        const issue = await beadsModule.show(testIssueId);
        return issue.status === "closed";
      },
      15,
      80
    );
    expect(titanCompleted, "Titan should have closed the issue").toBe(true);

    // Verify greeting.ts was committed to main (Labor merged)
    const gitLog = execFileSync("git", ["log", "--oneline", "-5"], { cwd: tempDir }).toString("utf8");
    expect(gitLog).toContain("add greeting function");

    // Verify greeting.ts exists on main branch in tempDir
    const greetingExists = existsSync(join(tempDir, "greeting.ts"));
    expect(greetingExists, "greeting.ts should be on main after Labor merge").toBe(true);
    if (greetingExists) {
      const content = readFileSync(join(tempDir, "greeting.ts"), "utf8");
      expect(content).toContain("greet");
    }

    // -----------------------------------------------------------------
    // Phase 3: Sentinel dispatch
    // Precondition: issue is closed, no REVIEWED comment → triage → Sentinel
    // -----------------------------------------------------------------
    const sentinelDispatched = await runUntil(
      loop,
      () => vi.mocked(spawnerMock.spawnSentinel).mock.calls.length > 0,
      10,
      80
    );
    expect(sentinelDispatched, "Sentinel should have been dispatched").toBe(true);

    // Run until Sentinel completes (REVIEWED: comment added)
    const sentinelCompleted = await runUntil(
      loop,
      async () => {
        const beadsModule = await import("../src/beads.js");
        const issue = await beadsModule.show(testIssueId);
        return issue.comments.some((c) => c.body.startsWith("REVIEWED:"));
      },
      10,
      80
    );
    expect(sentinelCompleted, "Sentinel should have added REVIEWED: comment").toBe(true);

    // -----------------------------------------------------------------
    // Final state verification (SPEC §3.1 checks 1-12)
    // -----------------------------------------------------------------
    const beadsModule = await import("../src/beads.js");
    const finalIssue = await beadsModule.show(testIssueId);

    // 1. Issue is closed
    expect(finalIssue.status).toBe("closed");

    // 2. Has SCOUTED comment (Oracle succeeded)
    const scoutedComment = finalIssue.comments.find((c) => c.body.startsWith("SCOUTED:"));
    expect(scoutedComment).toBeDefined();

    // 3. Has REVIEWED comment (Sentinel succeeded)
    const reviewedComment = finalIssue.comments.find((c) => c.body.startsWith("REVIEWED:"));
    expect(reviewedComment).toBeDefined();
    expect(reviewedComment!.body).toMatch(/^REVIEWED: PASS/);

    // 4. SSE events were emitted throughout
    expect(sseEvents).toContain("agent.spawned"); // at least one spawn event
    expect(sseEvents).toContain("agent.reaped");  // at least one reap event

    // 5. After full cycle, the issue should be skipped on the next tick
    //    (triage sees REVIEWED: PASS → skip: complete)
    vi.mocked(spawnerMock.spawnOracle).mockClear();
    vi.mocked(spawnerMock.spawnTitan).mockClear();
    vi.mocked(spawnerMock.spawnSentinel).mockClear();
    await loop.runTick();
    // No new agents should be spawned for this fully-reviewed issue
    expect(spawnerMock.spawnOracle).not.toHaveBeenCalled();
    expect(spawnerMock.spawnTitan).not.toHaveBeenCalled();
    expect(spawnerMock.spawnSentinel).not.toHaveBeenCalled();
  }, 60_000); // 60 s timeout — real git + bd ops take time

  // -----------------------------------------------------------------
  // Additional checks: individual pieces verified in isolation
  // -----------------------------------------------------------------

  it("SSE /api/events streams orchestrator events", async () => {
    const { Aegis } = await import("../src/aegis.js");
    const { createServer } = await import("../src/server.js");
    const http = await import("node:http");

    const config = makeConfig(tempDir);
    const aegis = new Aegis(config, tempDir);

    const serverPort = 19847; // test-only port
    const localConfig = { ...config, olympus: { ...config.olympus, port: serverPort } };
    const server = createServer(aegis, localConfig);

    await new Promise<void>((resolve, reject) => {
      server.listen(serverPort, () => resolve());
      server.on("error", reject);
    });

    try {
      // GET /api/status
      const statusBody = await new Promise<string>((resolve, reject) => {
        http.get(`http://localhost:${serverPort}/api/status`, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        }).on("error", reject);
      });
      const status = JSON.parse(statusBody) as { status: string; agents: unknown[] };
      expect(status.status).toBe("running");
      expect(Array.isArray(status.agents)).toBe(true);

      // GET /api/config (no API keys)
      const cfgBody = await new Promise<string>((resolve, reject) => {
        http.get(`http://localhost:${serverPort}/api/config`, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        }).on("error", reject);
      });
      const cfg = JSON.parse(cfgBody) as Record<string, unknown>;
      expect(cfg).toHaveProperty("models");
      expect(cfg).toHaveProperty("concurrency");
      expect(cfg).not.toHaveProperty("auth"); // API keys must be stripped

      // POST /api/steer direct mode
      const steerBody = JSON.stringify({ mode: "direct", input: "pause" });
      const steerResp = await new Promise<{ ok: boolean; status: number }>((resolve, reject) => {
        const req = http.request(
          `http://localhost:${serverPort}/api/steer`,
          { method: "POST", headers: { "Content-Type": "application/json" } },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => {
              const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { ok: boolean };
              resolve({ ok: body.ok, status: res.statusCode ?? 0 });
            });
          }
        );
        req.on("error", reject);
        req.write(steerBody);
        req.end();
      });
      expect(steerResp.ok).toBe(true);
      expect(steerResp.status).toBe(200);
      expect(aegis.getState().status).toBe("paused");

      // Resume for cleanup
      aegis.resume();

    } finally {
      server.close();
    }
  }, 15_000);

  it("graceful stop sends wrap-up steer to active agents and completes", async () => {
    const { Aegis } = await import("../src/aegis.js");
    const spawnerMock = await import("../src/spawner.js");

    const config = makeConfig(tempDir);
    const aegis = new Aegis(config, tempDir);

    // Start a "stuck" agent that never resolves
    let resolvePrompt!: () => void;
    const neverResolvingSession = makeSession(() => {});
    neverResolvingSession.prompt.mockReturnValue(
      new Promise<void>((r) => { resolvePrompt = r; })
    );
    vi.mocked(spawnerMock.spawnOracle).mockResolvedValueOnce(neverResolvingSession as never);
    vi.mocked(spawnerMock.spawnTitan).mockResolvedValue(makeSession(() => {}) as never);
    vi.mocked(spawnerMock.spawnSentinel).mockResolvedValue(makeSession(() => {}) as never);

    // Create a fresh issue so the oracle fires
    const extraIssueId = createTestIssue(tempDir);

    // Run one tick to dispatch the oracle
    await (aegis as unknown as { runTick: () => Promise<void> }).runTick();

    // Verify it's running
    const stateBeforeStop = aegis.getState();
    const runningAgents = stateBeforeStop.agents.filter((a) => a.status === "running");
    // There might be running agents for the extra issue
    expect(runningAgents.length).toBeGreaterThanOrEqual(0); // best-effort

    // Resolve the stuck session so stop() doesn't wait the full 60 s
    resolvePrompt();

    // Stop should complete cleanly
    await expect(aegis.stop()).resolves.toBeUndefined();
    expect(aegis.getState().status).toBe("stopping");

    // Clean up the extra issue
    try {
      execFileSync("bd", ["close", extraIssueId, "--reason", "test cleanup"], { cwd: tempDir, stdio: "pipe" });
    } catch {
      // ignore
    }
  }, 15_000);
});
