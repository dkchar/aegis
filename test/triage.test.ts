// test/triage.test.ts
// Unit tests for src/triage.ts

import { describe, it, expect } from "vitest";
import { triage } from "../src/triage.js";
import type { BeadsIssue, AgentState, AegisConfig } from "../src/types.js";

function makeIssue(overrides = {}) {
  return { id: "aegis-001", title: "Test issue", description: "A test issue", type: "task", priority: 1, status: "open", comments: [], ...overrides };
}
function makeComment(body) {
  return { id: "c1", body, author: "agent", created_at: "2026-01-01T00:00:00Z" };
}
function makeRunningAgents(agents = []) {
  const map = new Map();
  agents.forEach((a, i) => {
    const state = { id: "agent-" + i, caste: "oracle", issue_id: "aegis-" + i, issue_title: "Issue " + i, model: "claude-haiku-4-5", turns: 0, max_turns: 100, tokens: 0, max_tokens: 100000, cost_usd: 0, started_at: Date.now(), last_tool_call_at: Date.now(), status: "running", labor_path: null, ...a };
    map.set(state.issue_id, state);
  });
  return map;
}
const LIMITS = { max_agents: 10, max_oracles: 3, max_titans: 3, max_sentinels: 2 };

describe("triage()", () => {
  it("returns dispatch_oracle for issue with no SCOUTED comment", () => {
    const issue = makeIssue({ status: "open", comments: [] });
    const result = triage(issue, new Map(), LIMITS);
    expect(result.type).toBe("dispatch_oracle");
  });

  it("returns dispatch_oracle when no comment starts with SCOUTED:", () => {
    const issue = makeIssue({ comments: [makeComment("Just a note"), makeComment("scouted: lowercase")] });
    const result = triage(issue, new Map(), LIMITS);
    expect(result.type).toBe("dispatch_oracle");
  });

  it("returns dispatch_titan for open issue with SCOUTED comment", () => {
    const scoutBody = "SCOUTED: Simple module";
    const issue = makeIssue({ status: "open", comments: [makeComment(scoutBody)] });
    const result = triage(issue, new Map(), LIMITS);
    expect(result.type).toBe("dispatch_titan");
    if (result.type === "dispatch_titan") expect(result.scoutComment).toBe(scoutBody);
  });

  it("returns dispatch_titan for ready issue with SCOUTED comment", () => {
    const issue = makeIssue({ status: "ready", comments: [makeComment("SCOUTED: Ready")] });
    const result = triage(issue, new Map(), LIMITS);
    expect(result.type).toBe("dispatch_titan");
  });

  it("extracts full scout comment body including prefix", () => {
    const fullBody = "SCOUTED: Config module, no deps beyond node:fs.";
    const issue = makeIssue({ status: "open", comments: [makeComment("Unrelated"), makeComment(fullBody)] });
    const result = triage(issue, new Map(), LIMITS);
    expect(result.type).toBe("dispatch_titan");
    if (result.type === "dispatch_titan") expect(result.scoutComment).toBe(fullBody);
  });

  it("returns dispatch_sentinel for closed issue with no REVIEWED comment", () => {
    const scoutBody = "SCOUTED: All done";
    const issue = makeIssue({ status: "closed", comments: [makeComment(scoutBody)] });
    const result = triage(issue, new Map(), LIMITS);
    expect(result.type).toBe("dispatch_sentinel");
    if (result.type === "dispatch_sentinel") expect(result.scoutComment).toBe(scoutBody);
  });

  it("returns skip complete for closed issue with REVIEWED: PASS", () => {
    const issue = makeIssue({ status: "closed", comments: [makeComment("SCOUTED: All good"), makeComment("REVIEWED: PASS - looks clean")] });
    const result = triage(issue, new Map(), LIMITS);
    expect(result.type).toBe("skip");
    if (result.type === "skip") expect(result.reason).toBe("complete");
  });

  it("returns skip review-failed for closed issue with REVIEWED: FAIL", () => {
    const issue = makeIssue({ status: "closed", comments: [makeComment("SCOUTED: Looked good"), makeComment("REVIEWED: FAIL - missing tests")] });
    const result = triage(issue, new Map(), LIMITS);
    expect(result.type).toBe("skip");
    if (result.type === "skip") expect(result.reason).toBe("review failed, fix issues filed");
  });

  it("returns skip when global max_agents limit is reached", () => {
    const strictLimits = { ...LIMITS, max_agents: 2 };
    const running = makeRunningAgents([{ issue_id: "aegis-x1", caste: "oracle" }, { issue_id: "aegis-x2", caste: "titan" }]);
    const result = triage(makeIssue(), running, strictLimits);
    expect(result.type).toBe("skip");
    if (result.type === "skip") expect(result.reason).toBe("concurrency limit");
  });

  it("returns skip when oracle per-caste limit is reached", () => {
    const strictLimits = { ...LIMITS, max_oracles: 1 };
    const running = makeRunningAgents([{ issue_id: "aegis-x1", caste: "oracle" }]);
    const result = triage(makeIssue(), running, strictLimits);
    expect(result.type).toBe("skip");
    if (result.type === "skip") expect(result.reason).toBe("concurrency limit");
  });

  it("returns skip when titan per-caste limit is reached", () => {
    const strictLimits = { ...LIMITS, max_titans: 1 };
    const running = makeRunningAgents([{ issue_id: "aegis-x1", caste: "titan" }]);
    const issue = makeIssue({ status: "open", comments: [makeComment("SCOUTED: Ready")] });
    const result = triage(issue, running, strictLimits);
    expect(result.type).toBe("skip");
    if (result.type === "skip") expect(result.reason).toBe("concurrency limit");
  });

  it("returns skip when sentinel per-caste limit is reached", () => {
    const strictLimits = { ...LIMITS, max_sentinels: 1 };
    const running = makeRunningAgents([{ issue_id: "aegis-x1", caste: "sentinel" }]);
    const issue = makeIssue({ status: "closed", comments: [makeComment("SCOUTED: Implemented")] });
    const result = triage(issue, running, strictLimits);
    expect(result.type).toBe("skip");
    if (result.type === "skip") expect(result.reason).toBe("concurrency limit");
  });

  it("dispatches oracle when titan slots full but oracle slots available", () => {
    const strictLimits = { ...LIMITS, max_titans: 1 };
    const running = makeRunningAgents([{ issue_id: "aegis-x1", caste: "titan" }]);
    const result = triage(makeIssue({ status: "open", comments: [] }), running, strictLimits);
    expect(result.type).toBe("dispatch_oracle");
  });

  it("returns skip 'already in progress' for in_progress issue with SCOUTED comment", () => {
    const issue = makeIssue({ status: "in_progress", comments: [makeComment("SCOUTED: Claimed")] });
    const result = triage(issue, new Map(), LIMITS);
    expect(result.type).toBe("skip");
    if (result.type === "skip") expect(result.reason).toBe("already in progress");
  });

  it("returns skip 'deferred' for deferred issue with SCOUTED comment", () => {
    const issue = makeIssue({ status: "deferred", comments: [makeComment("SCOUTED: Deferred")] });
    const result = triage(issue, new Map(), LIMITS);
    expect(result.type).toBe("skip");
    if (result.type === "skip") expect(result.reason).toBe("deferred");
  });

  it("SCOUTED: is case-sensitive, lowercase scouted: does not match", () => {
    const issue = makeIssue({ status: "open", comments: [makeComment("scouted: lowercase prefix")] });
    const result = triage(issue, new Map(), LIMITS);
    expect(result.type).toBe("dispatch_oracle");
  });

  it("REVIEWED: is case-sensitive, lowercase reviewed: does not match", () => {
    const issue = makeIssue({ status: "closed", comments: [makeComment("SCOUTED: Fine"), makeComment("reviewed: pass - lowercase")] });
    const result = triage(issue, new Map(), LIMITS);
    expect(result.type).toBe("dispatch_sentinel");
  });

  it("uses the first SCOUTED: comment when multiple exist", () => {
    const firstScout = "SCOUTED: First assessment";
    const issue = makeIssue({ status: "open", comments: [makeComment("Just a note"), makeComment(firstScout), makeComment("SCOUTED: Second")] });
    const result = triage(issue, new Map(), LIMITS);
    expect(result.type).toBe("dispatch_titan");
    if (result.type === "dispatch_titan") expect(result.scoutComment).toBe(firstScout);
  });
});