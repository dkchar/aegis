import path from "node:path";
import { describe, expect, test } from "vitest";

const modelPath = path.join(process.cwd(), "olympus", "src", "aether", "model.js");

async function loadModel() {
  return import(modelPath);
}

function ticket(id: string, column: string, extra: Record<string, unknown> = {}) {
  return { id, title: `Ticket ${id}`, column, labels: [], blockedBy: [], scope: [], ...extra };
}

function record(issueId: string, stage: string, runningAgent: { caste: string; sessionId: string } | null = null) {
  return { issueId, stage, runningAgent, failureCount: 0, fileScope: null, updatedAt: "2026-10-01T00:00:00.000Z" };
}

describe("Aether stations and routes", () => {
  test("every route and handoff references real stations", async () => {
    const { ROUTES, STATIONS, STATION_BY_ID, describeEvent } = await loadModel();
    for (const route of ROUTES) {
      expect(STATION_BY_ID[route.from]).toBeDefined();
      expect(STATION_BY_ID[route.to]).toBeDefined();
    }
    for (const station of STATIONS) {
      expect(station.portrait).toEqual({ x: expect.any(Number), y: expect.any(Number) });
    }
    const routeIds = new Set(ROUTES.map((route: { id: string }) => route.id));
    const outcomes = ["scouted", "implemented", "queued_for_merge", "rework_required"];
    for (const outcome of outcomes) {
      const signal = describeEvent({ seq: 1, phase: "reap", issueId: "AG-1", action: "finalize_session", outcome });
      expect(routeIds.has(signal.effect.route)).toBe(true);
    }
  });
});

describe("placeTicket", () => {
  test("follows the dispatch stage and pins live sessions to their caste", async () => {
    const { placeTicket } = await loadModel();
    expect(placeTicket(ticket("AG-1", "in_progress"), record("AG-1", "scouting", { caste: "oracle", sessionId: "s1" })))
      .toEqual({ station: "oracle", status: "running" });
    expect(placeTicket(ticket("AG-1", "in_progress"), record("AG-1", "scouted"))).toEqual({ station: "titan", status: "queued" });
    expect(placeTicket(ticket("AG-1", "in_review"), record("AG-1", "reviewing"))).toEqual({ station: "sentinel", status: "queued" });
    expect(placeTicket(ticket("AG-1", "in_progress"), record("AG-1", "rework_required"))).toEqual({ station: "titan", status: "rework" });
    expect(placeTicket(ticket("AG-1", "ready_to_merge"), record("AG-1", "merging"))).toEqual({ station: "merge", status: "queued" });
    expect(placeTicket(ticket("AG-1", "in_review"), record("AG-1", "resolving_integration", { caste: "janus", sessionId: "s2" })))
      .toEqual({ station: "janus", status: "running" });
    expect(placeTicket(ticket("AG-1", "blocked"), record("AG-1", "blocked_on_child"))).toEqual({ station: "blocked", status: "blocked" });
    expect(placeTicket(ticket("AG-1", "in_progress"), record("AG-1", "failed_operational"))).toEqual({ station: "attention", status: "failed" });
  });

  test("falls back to the Agora column and lets terminal columns win", async () => {
    const { placeTicket } = await loadModel();
    expect(placeTicket(ticket("AG-1", "backlog"), null)).toEqual({ station: "agora", status: "backlog" });
    expect(placeTicket(ticket("AG-1", "ready"), record("AG-1", "pending"))).toEqual({ station: "agora", status: "ready" });
    expect(placeTicket(ticket("AG-1", "blocked"), null)).toEqual({ station: "blocked", status: "blocked" });
    expect(placeTicket(ticket("AG-1", "done"), record("AG-1", "implementing"))).toEqual({ station: "trunk", status: "done" });
    expect(placeTicket(ticket("AG-1", "halted"), null)).toEqual({ station: "attention", status: "failed" });
  });
});

describe("buildAetherScene", () => {
  test("builds one mote per executable ticket with load and totals", async () => {
    const { buildAetherScene } = await loadModel();
    const scene = buildAetherScene({
      tickets: [
        ticket("AG-1", "done"),
        ticket("AG-2", "in_progress"),
        ticket("AG-3", "blocked", { blockedBy: ["AG-1", "AG-2", "AG-404"] }),
        ticket("AG-10", "ready"),
        ticket("AG-0", "ready", { labels: ["role:coordination"] }),
      ],
      dispatchRecords: [record("AG-2", "implementing", { caste: "titan", sessionId: "s-titan" })],
      agents: [{
        id: "s-titan",
        status: "running",
        lines: ["[tool] Write src/app.tsx", "[phase] 10:00:00 dispatch launch_titan"],
      }],
    });

    expect(scene.motes.map((mote: { id: string }) => mote.id)).toEqual(["AG-1", "AG-2", "AG-3", "AG-10"]);
    const titan = scene.motes.find((mote: { id: string }) => mote.id === "AG-2");
    expect(titan).toMatchObject({ station: "titan", status: "running", caste: "titan", tone: "primary", sessionId: "s-titan" });
    expect(titan.activity).toBe("[tool] Write src/app.tsx");
    // A landed or unknown blocker no longer holds the ticket back.
    expect(scene.motes.find((mote: { id: string }) => mote.id === "AG-3").blockedBy).toEqual(["AG-2"]);
    expect(scene.load.titan).toEqual({ total: 1, running: 1 });
    expect(scene.totals).toEqual({ tickets: 4, done: 1, inFlight: 1, running: 1, attention: 0, blocked: 1 });
  });
});

describe("describeEvent", () => {
  const event = (action: string, outcome: string, issueId = "AG-7", detail?: string) =>
    ({ seq: 42, timestamp: "2026-10-01T00:00:00.000Z", phase: "dispatch", issueId, action, outcome, detail });

  test("turns typed handoffs into packets between stations", async () => {
    const { describeEvent } = await loadModel();
    expect(describeEvent(event("finalize_session", "scouted"))).toMatchObject({
      seq: 42,
      issueId: "AG-7",
      text: "Oracle handed AG-7 to Titan",
      effect: { kind: "packet", route: "oracle-titan" },
    });
    expect(describeEvent(event("sentinel_review_completed", "rework_required"))).toMatchObject({
      tone: "danger",
      effect: { kind: "packet", route: "sentinel-titan" },
    });
    expect(describeEvent(event("janus_resolution_completed", "rework_required")).effect.route).toBe("janus-titan");
  });

  test("describes launches, merges, and failures", async () => {
    const { describeEvent } = await loadModel();
    expect(describeEvent(event("launch_sentinel", "running"))).toMatchObject({
      text: "Sentinel session started on AG-7",
      tone: "violet",
      effect: { kind: "ignite" },
    });
    expect(describeEvent(event("launch_titan", "failed")).effect.kind).toBe("shock");
    expect(describeEvent(event("merge_candidate", "merged"))).toMatchObject({
      text: "AG-7 landed on the trunk",
      effect: { kind: "packet", route: "merge-trunk", flare: "trunk" },
    });
    expect(describeEvent(event("merge_candidate", "requeued", "AG-7", "{\"tier\":\"T2\"}")).text)
      .toBe("AG-7 requeued at the merge queue (T2)");
    expect(describeEvent(event("merge_candidate", "escalated")).effect.route).toBe("merge-janus");
    expect(describeEvent(event("finalize_session", "failed")).effect.kind).toBe("shock");
    expect(describeEvent(event("stuck_kill_threshold", "kill")).tone).toBe("danger");
  });

  test("keeps cycle summaries out of the feed and ignores unknown actions", async () => {
    const { describeEvent, buildSignalFeed } = await loadModel();
    const poll = describeEvent(event("poll_ready_work", "ok", "_all"));
    expect(poll).toMatchObject({ text: null, effect: { kind: "pulse", station: "agora" } });
    expect(describeEvent(event("monitor_active_work", "ok", "_all"))).toBeNull();
    expect(describeEvent(event("session_observed", "succeeded"))).toBeNull();

    const feed = buildSignalFeed([
      { ...event("poll_ready_work", "ok", "_all"), seq: 1 },
      { ...event("launch_oracle", "running"), seq: 2 },
      { ...event("finalize_session", "scouted"), seq: 3 },
    ]);
    expect(feed.map((signal: { seq: number }) => signal.seq)).toEqual([3, 2]);
  });
});

describe("isErrorActivity", () => {
  test("flags tool errors and denials", async () => {
    const { isErrorActivity } = await loadModel();
    expect(isErrorActivity("[tool_error] TS2304")).toBe(true);
    expect(isErrorActivity("[tool] permission denied: Write")).toBe(true);
    expect(isErrorActivity("[tool] Read src/app.tsx")).toBe(false);
  });
});
