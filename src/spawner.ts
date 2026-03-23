// src/spawner.ts
// Spawner -- the ONLY module that calls createAgentSession().

import { mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

import { createAgentSession, SessionManager, AuthStorage, ModelRegistry, readOnlyTools, codingTools } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { AgentHandle, AgentStats, BeadsIssue, MnemosyneRecord, AegisConfig, Caste } from "./types.js";

/**
 * Returns the default Pi agent config directory (~/.pi/agent).
 * AuthStorage reads auth.json from here, where /login stores subscription tokens.
 */
function getAgentDir(): string {
  return join(homedir(), ".pi", "agent");
}

/**
 * Windows-only pre-spawn environment fixes. Safe to call on all platforms
 * (all branches are guarded by platform checks).
 *
 * Fix 1 — aegis-l1a: Pi's bg-process extension writes logs to C:\tmp\oh-pi-bg-*.log.
 * That directory does not exist by default on Windows, causing an ENOENT crash when
 * the extension initialises. Creating it once before any spawn avoids the crash.
 *
 * Fix 2 — aegis-670: When Aegis is launched from Git Bash, MSYSTEM is set (e.g.
 * "MINGW64") and SHELL points to Git Bash's bash.  Pi agents that fork subprocesses
 * inherit these environment variables, which causes "cygheap read copy failed" errors
 * because the cygwin heap cannot be mapped at the same address in the child process.
 * Redirecting SHELL and COMSPEC to the native Windows cmd.exe prevents the fork
 * failure while leaving all Git Bash convenience intact for the user's own shell.
 */
function applyWindowsSpawnFixes(): void {
  if (platform() !== "win32") return;

  // Fix 1: ensure C:\tmp exists for the Pi bg-process extension log sink.
  try {
    mkdirSync("C:\\tmp", { recursive: true });
  } catch {
    // best-effort — if we can't create it, the extension crash will surface on
    // its own rather than silently breaking spawns.
  }

  // Fix 2: when running under Git Bash (MSYSTEM is set), override SHELL and
  // COMSPEC so spawned child processes use native Windows cmd.exe, not cygwin bash.
  if (process.env["MSYSTEM"]) {
    process.env["SHELL"] = "cmd.exe";
    if (!process.env["COMSPEC"]) {
      process.env["COMSPEC"] = "C:\\Windows\\System32\\cmd.exe";
    }
  }
}

export function casteToolFilter(caste: Caste): typeof codingTools | typeof readOnlyTools {
  if (caste === "titan") return codingTools;
  return readOnlyTools;
}

function toAgentStats(session: Pick<AgentSession, "getSessionStats">): AgentStats {
  const stats = session.getSessionStats();
  return {
    sessionId: stats.sessionId,
    cost: stats.cost,
    tokens: {
      total: stats.tokens.total,
      input: stats.tokens.input,
      output: stats.tokens.output,
      cacheRead: stats.tokens.cacheRead,
      cacheWrite: stats.tokens.cacheWrite,
    },
  };
}

function toAgentHandle(
  session: Pick<AgentSession, "prompt" | "steer" | "abort" | "subscribe" | "getSessionStats">
): AgentHandle {
  return {
    prompt: (text) => session.prompt(text),
    steer: (text) => session.steer(text),
    abort: () => session.abort(),
    subscribe: (listener) => session.subscribe((event) => listener(event)),
    getStats: () => toAgentStats(session),
  };
}

function formatLearnings(learnings: MnemosyneRecord[]): string {
  if (learnings.length === 0) return "(none)";
  return learnings.map((r) => "[" + r.type + ":" + r.domain + "] " + r.text).join("\n");
}

function extractScoutComment(issue: BeadsIssue): string {
  const c = (issue.comments ?? []).find((c) => c.body.startsWith("SCOUTED:"));
  return c ? c.body : "(no oracle assessment available)";
}

export function buildSystemPrompt(caste: Caste, issue: BeadsIssue, learnings: MnemosyneRecord[], agentsMd: string): string {
  const lb = formatLearnings(learnings);
  if (caste === "oracle") {
    return [
      "You are an Oracle agent. Your job is to explore and assess, not implement.",
      "",
      "ISSUE: " + issue.title,
      "DESCRIPTION: " + issue.description,
      "PRIORITY: " + issue.priority,
      "",
      "LEARNINGS:",
      lb,
      "",
      "INSTRUCTIONS:",
      "1. Run bd show " + issue.id + " --json for full details",
      "2. Explore the codebase",
      "3. Assess complexity and identify files needing changes",
      "4. Create beads issues for discovered work",
      '5. Write: bd comment ' + issue.id + ' "SCOUTED: <assessment>"',
      "",
      "Do NOT modify any files. Do NOT write code. Explore and report only.",
      "",
      "PROJECT AGENTS.md:",
      agentsMd,
    ].join("\n");
  }
  if (caste === "titan") {
    const sc = extractScoutComment(issue);
    return [
      "You are a Titan agent. Implement the assigned beads issue.",
      "",
      "ISSUE: " + issue.title + " (" + issue.id + ")",
      "DESCRIPTION: " + issue.description,
      "ORACLE ASSESSMENT: " + sc,
      "",
      "LEARNINGS:",
      lb,
      "",
      "INSTRUCTIONS:",
      "1. Claim: bd update " + issue.id + " --claim",
      "2. Read assessment and relevant code",
      "3. Implement the change",
      "4. Run tests",
      "5. Commit if tests pass",
      '6. Close: bd close ' + issue.id + ' --reason "Done"',
      "7. Create issues for discovered work",
      "8. Record learnings in .aegis/mnemosyne.jsonl",
      "",
      "Do NOT close until tests pass. Focus on " + issue.id + " only.",
      "",
      "PROJECT AGENTS.md:",
      agentsMd,
    ].join("\n");
  }
  const sc = extractScoutComment(issue);
  return [
    "You are a Sentinel agent. Review completed work.",
    "",
    "ISSUE: " + issue.title + " (" + issue.id + ")",
    "DESCRIPTION: " + issue.description,
    "ORACLE ASSESSMENT: " + sc,
    "",
    "LEARNINGS:",
    lb,
    "",
    "INSTRUCTIONS:",
    "1. Read description and oracle assessment",
    "2. Examine changes (git diff against base branch)",
    "3. Check test coverage",
    "4. Check for bugs, security issues, quality problems",
    "5. If acceptable:",
    '   bd comment ' + issue.id + ' "REVIEWED: PASS - <summary>"',
    "6. If issues found:",
    "   - Create beads issues for each problem",
    '   - bd comment ' + issue.id + ' "REVIEWED: FAIL - <summary>"',
    "",
    "Be thorough but proportional.",
    "",
    "PROJECT AGENTS.md:",
    agentsMd,
  ].join("\n");
}

function makeAuthStorage(config: AegisConfig): AuthStorage {
  // Use file-backed AuthStorage so Pi subscription credentials stored at
  // ~/.pi/agent/auth.json (written by `pi /login`) are discovered automatically.
  const agentDir = getAgentDir();
  const s = AuthStorage.create(join(agentDir, "auth.json"));

  // Apply explicit API keys from config as runtime overrides (highest priority,
  // not persisted to disk). If null, the file-backed storage handles auth.
  if (config.auth.anthropic) s.setRuntimeApiKey("anthropic", config.auth.anthropic);
  if (config.auth.openai) s.setRuntimeApiKey("openai", config.auth.openai);
  if (config.auth.google) s.setRuntimeApiKey("google", config.auth.google);
  return s;
}

async function spawnSession(caste: Caste, issue: BeadsIssue, learnings: MnemosyneRecord[], config: AegisConfig, agentsMd: string, workingDir: string, modelName: string): Promise<AgentHandle> {
  applyWindowsSpawnFixes();
  const authStorage = makeAuthStorage(config);
  const modelRegistry = new ModelRegistry(authStorage);
  let model;
  // getModel is generic over known literal model IDs; we use runtime config strings
  // so we cast through unknown to bypass the strict literal check.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getModelAny = getModel as (provider: string, id: string) => any;
  if (modelName.includes(":")) {
    const parts = modelName.split(":", 2);
    const provider = parts[0] ?? "anthropic";
    const id = parts[1] ?? modelName;
    model = getModelAny(provider, id);
  } else {
    model = getModelAny("anthropic", modelName);
  }
  if (!model) throw new Error(`Model not found: ${modelName}`);
  const { session } = await createAgentSession({
    cwd: workingDir,
    agentDir: getAgentDir(),
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
    model,
    tools: casteToolFilter(caste),
    systemPrompt: buildSystemPrompt(caste, issue, learnings, agentsMd),
  } as Parameters<typeof createAgentSession>[0]);
  return toAgentHandle(session);
}

export async function spawnOracle(issue: BeadsIssue, learnings: MnemosyneRecord[], config: AegisConfig, agentsMd: string): Promise<AgentHandle> {
  return spawnSession("oracle", issue, learnings, config, agentsMd, process.cwd(), config.models.oracle);
}

export async function spawnTitan(issue: BeadsIssue, learnings: MnemosyneRecord[], laborPath: string, config: AegisConfig, agentsMd: string): Promise<AgentHandle> {
  return spawnSession("titan", issue, learnings, config, agentsMd, laborPath, config.models.titan);
}

export async function spawnSentinel(issue: BeadsIssue, learnings: MnemosyneRecord[], config: AegisConfig, agentsMd: string): Promise<AgentHandle> {
  return spawnSession("sentinel", issue, learnings, config, agentsMd, process.cwd(), config.models.sentinel);
}
