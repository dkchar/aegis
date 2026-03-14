// src/spawner.ts
// Spawner -- the ONLY module that calls createAgentSession().

import { createAgentSession, SessionManager, AuthStorage, InMemoryAuthStorageBackend, readOnlyTools, codingTools } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { BeadsIssue, MnemosyneRecord, AegisConfig, Caste } from "./types.js";

export function casteToolFilter(caste: Caste): typeof codingTools | typeof readOnlyTools {
  if (caste === "titan") return codingTools;
  return readOnlyTools;
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
  // AuthStorage.fromStorage is the public factory for a custom backend.
  const s = AuthStorage.fromStorage(new InMemoryAuthStorageBackend());
  if (config.auth.anthropic) void s.set("anthropic", { type: "api_key", key: config.auth.anthropic });
  if (config.auth.openai) void s.set("openai", { type: "api_key", key: config.auth.openai });
  if (config.auth.google) void s.set("google", { type: "api_key", key: config.auth.google });
  return s;
}

async function spawnSession(caste: Caste, issue: BeadsIssue, learnings: MnemosyneRecord[], config: AegisConfig, agentsMd: string, workingDir: string, modelName: string): Promise<AgentSession> {
  const authStorage = makeAuthStorage(config);
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
  const { session } = await createAgentSession({
    cwd: workingDir,
    sessionManager: SessionManager.inMemory(),
    authStorage,
    model,
    tools: casteToolFilter(caste),
    systemPrompt: buildSystemPrompt(caste, issue, learnings, agentsMd),
  } as Parameters<typeof createAgentSession>[0]);
  return session;
}

export async function spawnOracle(issue: BeadsIssue, learnings: MnemosyneRecord[], config: AegisConfig, agentsMd: string): Promise<AgentSession> {
  return spawnSession("oracle", issue, learnings, config, agentsMd, process.cwd(), config.models.oracle);
}

export async function spawnTitan(issue: BeadsIssue, learnings: MnemosyneRecord[], laborPath: string, config: AegisConfig, agentsMd: string): Promise<AgentSession> {
  return spawnSession("titan", issue, learnings, config, agentsMd, laborPath, config.models.titan);
}

export async function spawnSentinel(issue: BeadsIssue, learnings: MnemosyneRecord[], config: AegisConfig, agentsMd: string): Promise<AgentSession> {
  return spawnSession("sentinel", issue, learnings, config, agentsMd, process.cwd(), config.models.sentinel);
}