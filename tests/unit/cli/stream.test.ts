import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { streamDaemonView, streamSessionView } from "../../../src/cli/stream.js";
import { writeRuntimeState, type RuntimeStateRecord } from "../../../src/cli/runtime-state.js";
import { writeSessionReport } from "../../../src/runtime/session-report.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-stream-"));
  tempRoots.push(root);
  mkdirSync(path.join(root, ".aegis", "logs", "phases"), { recursive: true });
  return root;
}

function writePhaseFile(
  root: string,
  filename: string,
  entry: object,
) {
  writeFileSync(
    path.join(root, ".aegis", "logs", "phases", filename),
    `${JSON.stringify(entry, null, 2)}\n`,
    "utf8",
  );
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("streamDaemonView", () => {
  it("streams new daemon and phase entries while skipping historical files", async () => {
    const root = createTempRoot();
    const daemonLogPath = path.join(root, ".aegis", "logs", "daemon.log");
    writeFileSync(daemonLogPath, "old-line\n", "utf8");

    writePhaseFile(root, "old.json", {
      timestamp: "2026-04-19T16:00:00.000Z",
      phase: "poll",
      issueId: "_all",
      action: "poll_ready_work",
      outcome: "ok",
    });

    const runningState: RuntimeStateRecord = {
      schema_version: 1,
      pid: 4242,
      server_state: "running",
      mode: "auto",
      started_at: "2026-04-19T16:00:00.000Z",
    };
    writeRuntimeState(runningState, root);

    const lines: string[] = [];
    let sleepCalls = 0;
    await streamDaemonView(root, {
      maxPolls: 2,
      pollIntervalMs: 0,
      writeLine: (line) => {
        lines.push(line);
      },
      sleep: async () => {
        sleepCalls += 1;
        writeFileSync(
          daemonLogPath,
          "old-line\n2026-04-19T16:00:05.000Z [daemon][heartbeat] mode=auto\n",
          "utf8",
        );
        writePhaseFile(root, "new.json", {
          timestamp: "2026-04-19T16:00:05.000Z",
          phase: "dispatch",
          issueId: "aegis-1",
          action: "launch_oracle",
          outcome: "running",
          sessionId: "session-1",
        });
        writeRuntimeState(
          {
            ...runningState,
            server_state: "stopped",
            stopped_at: "2026-04-19T16:00:06.000Z",
            last_stop_reason: "manual",
          },
          root,
        );
      },
    });

    expect(sleepCalls).toBe(1);
    expect(lines.some((line) => line.includes("old-line"))).toBe(false);
    expect(lines.some((line) => line.includes("[runtime] state=running"))).toBe(true);
    expect(lines.some((line) => line.includes("[runtime] state=stopped"))).toBe(true);
    expect(lines.some((line) => line.includes("[daemon] 2026-04-19T16:00:05.000Z [daemon][heartbeat] mode=auto"))).toBe(true);
    expect(lines.some((line) => line.includes("[DISPATCH] issue=aegis-1 action=launch_oracle outcome=running caste=oracle session=session-1"))).toBe(true);
    expect(lines.some((line) => line.includes("old.json"))).toBe(false);
  });

  it("prints Janus phase detail payloads for stream-visible conflict resolution context", async () => {
    const root = createTempRoot();
    const lines: string[] = [];

    await streamDaemonView(root, {
      maxPolls: 2,
      pollIntervalMs: 0,
      writeLine: (line) => {
        lines.push(line);
      },
      sleep: async () => {
        writePhaseFile(root, "janus-started.json", {
          timestamp: "2026-04-19T16:10:00.000Z",
          phase: "dispatch",
          issueId: "aegis-janus-1",
          action: "janus_resolution_started",
          outcome: "running",
          detail: JSON.stringify({
            queueItemId: "queue-aegis-janus-1",
            mergeOutcome: "conflict",
            mergeDetail: "Merge conflict in src/index.ts",
            attempt: 3,
            tier: "T3",
            janusInvocation: 1,
          }),
        });
        writePhaseFile(root, "janus-completed.json", {
          timestamp: "2026-04-19T16:10:03.000Z",
          phase: "dispatch",
          issueId: "aegis-janus-1",
          action: "janus_resolution_completed",
          outcome: "failed",
          detail: JSON.stringify({
            queueItemId: "queue-aegis-janus-1",
            conflictSummary: "conflicting migrations remain unresolved",
            resolutionStrategy: "escalate to manual decision",
            recommendedNextAction: "manual_decision",
          }),
        });
      },
    });

    expect(lines.some((line) =>
      line.includes("action=janus_resolution_started")
      && line.includes("detail={\"queueItemId\":\"queue-aegis-janus-1\""),
    )).toBe(true);
    expect(lines.some((line) =>
      line.includes("action=janus_resolution_completed")
      && line.includes("\"recommendedNextAction\":\"manual_decision\""),
    )).toBe(true);
  });

  it("reports invalid phase entries instead of throwing", async () => {
    const root = createTempRoot();
    const lines: string[] = [];

    await streamDaemonView(root, {
      maxPolls: 2,
      pollIntervalMs: 0,
      writeLine: (line) => {
        lines.push(line);
      },
      sleep: async () => {
        writeFileSync(
          path.join(root, ".aegis", "logs", "phases", "invalid.json"),
          "{\"bad\":true}\n",
          "utf8",
        );
      },
    });

    expect(lines.some((line) => line.includes("[phase] invalid_entry file=invalid.json"))).toBe(true);
  });
});

describe("streamSessionView", () => {
  it("streams new session events and exits when the session finalizes", async () => {
    const root = createTempRoot();
    const sessionId = "session-1";
    const eventsPath = path.join(root, ".aegis", "logs", "sessions", `${sessionId}.events.jsonl`);
    mkdirSync(path.dirname(eventsPath), { recursive: true });
    writeFileSync(
      eventsPath,
      `${JSON.stringify({
        timestamp: "2026-04-19T16:00:00.000Z",
        sessionId,
        eventType: "session_started",
        summary: "old event",
      })}\n`,
      "utf8",
    );

    const lines: string[] = [];
    let sleepCalls = 0;
    await streamSessionView(root, sessionId, {
      maxPolls: 3,
      pollIntervalMs: 0,
      writeLine: (line) => {
        lines.push(line);
      },
      sleep: async () => {
        sleepCalls += 1;
        writeFileSync(
          eventsPath,
          `${JSON.stringify({
            timestamp: "2026-04-19T16:00:00.000Z",
            sessionId,
            eventType: "session_started",
            summary: "old event",
          })}\n${JSON.stringify({
            timestamp: "2026-04-19T16:00:05.000Z",
            sessionId,
            eventType: "assistant_message",
            summary: "new event",
          })}\n`,
          "utf8",
        );
        writeSessionReport(root, {
          sessionId,
          status: "succeeded",
          finishedAt: "2026-04-19T16:00:06.000Z",
        });
      },
    });

    expect(sleepCalls).toBe(1);
    expect(lines.some((line) => line.includes("old event"))).toBe(false);
    expect(lines.some((line) => line.includes("event=assistant_message") && line.includes("new event"))).toBe(true);
    expect(lines.some((line) => line.includes("status=succeeded") && line.includes("finished=2026-04-19T16:00:06.000Z"))).toBe(true);
  });
});

