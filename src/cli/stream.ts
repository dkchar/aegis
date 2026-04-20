import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { readRuntimeState, type RuntimeStateRecord } from "./runtime-state.js";
import type { PhaseLogEntry } from "../core/phase-log.js";
import { readSessionReport } from "../runtime/session-report.js";

const DEFAULT_POLL_INTERVAL_MS = 500;

export interface StreamDaemonOptions {
  pollIntervalMs?: number;
  maxPolls?: number;
  signal?: AbortSignal;
  writeLine?: (line: string) => void;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

interface DaemonStreamCursor {
  daemonOffset: number;
  seenPhaseFiles: Set<string>;
  runtimeFingerprint: string | null;
}

interface SessionStreamCursor {
  eventsOffset: number;
}

function resolveDaemonLogPath(root: string) {
  return path.join(path.resolve(root), ".aegis", "logs", "daemon.log");
}

function resolvePhaseLogDirectory(root: string) {
  return path.join(path.resolve(root), ".aegis", "logs", "phases");
}

function resolveSessionEventsPath(root: string, sessionId: string) {
  return path.join(path.resolve(root), ".aegis", "logs", "sessions", `${sessionId}.events.jsonl`);
}

function resolveRuntimeFingerprint(state: RuntimeStateRecord | null) {
  return state ? JSON.stringify(state) : "runtime:none";
}

function initializeCursor(root: string): DaemonStreamCursor {
  const daemonLogPath = resolveDaemonLogPath(root);
  const phaseLogDirectory = resolvePhaseLogDirectory(root);

  return {
    daemonOffset: existsSync(daemonLogPath) ? statSync(daemonLogPath).size : 0,
    seenPhaseFiles: existsSync(phaseLogDirectory)
      ? new Set(readdirSync(phaseLogDirectory).filter((entry) => entry.endsWith(".json")))
      : new Set<string>(),
    runtimeFingerprint: null,
  };
}

function formatRuntimeState(state: RuntimeStateRecord | null) {
  if (!state) {
    return "[runtime] state=missing";
  }

  const parts = [
    `[runtime] state=${state.server_state}`,
    `mode=${state.mode}`,
    `pid=${state.pid}`,
    `started=${state.started_at}`,
  ];

  if (state.server_state === "stopped") {
    if (state.stopped_at) {
      parts.push(`stopped=${state.stopped_at}`);
    }
    if (state.last_stop_reason) {
      parts.push(`reason=${state.last_stop_reason}`);
    }
  }

  return parts.join(" ");
}

function parsePhaseEntry(rawContents: string): PhaseLogEntry | null {
  const parsed = JSON.parse(rawContents) as Partial<PhaseLogEntry> | null;
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  if (
    typeof parsed.timestamp !== "string"
    || typeof parsed.phase !== "string"
    || typeof parsed.issueId !== "string"
    || typeof parsed.action !== "string"
    || typeof parsed.outcome !== "string"
  ) {
    return null;
  }

  return {
    timestamp: parsed.timestamp,
    phase: parsed.phase as PhaseLogEntry["phase"],
    issueId: parsed.issueId,
    action: parsed.action,
    outcome: parsed.outcome,
    sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
    detail: typeof parsed.detail === "string" ? parsed.detail : undefined,
  };
}

function formatPhaseEntry(entry: PhaseLogEntry) {
  const parts = [
    `[${entry.phase.toUpperCase()}]`,
    `issue=${entry.issueId}`,
    `action=${entry.action}`,
    `outcome=${entry.outcome}`,
  ];

  if (entry.phase === "dispatch" && entry.action.startsWith("launch_")) {
    parts.push(`caste=${entry.action.slice("launch_".length)}`);
  }

  if (entry.sessionId) {
    parts.push(`session=${entry.sessionId}`);
  }
  if (entry.detail) {
    parts.push(`detail=${entry.detail}`);
  }

  return parts.join(" ");
}

function initializeSessionCursor(root: string, sessionId: string): SessionStreamCursor {
  const sessionEventsPath = resolveSessionEventsPath(root, sessionId);
  return {
    eventsOffset: existsSync(sessionEventsPath) ? statSync(sessionEventsPath).size : 0,
  };
}

interface SessionLogEntry {
  timestamp: string;
  sessionId: string;
  eventType: string;
  summary: string;
  detail?: string;
}

function parseSessionEvent(rawLine: string): SessionLogEntry | null {
  const parsed = JSON.parse(rawLine) as Partial<SessionLogEntry> | null;
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  if (
    typeof parsed.timestamp !== "string"
    || typeof parsed.sessionId !== "string"
    || typeof parsed.eventType !== "string"
    || typeof parsed.summary !== "string"
  ) {
    return null;
  }

  return {
    timestamp: parsed.timestamp,
    sessionId: parsed.sessionId,
    eventType: parsed.eventType,
    summary: parsed.summary,
    detail: typeof parsed.detail === "string" ? parsed.detail : undefined,
  };
}

function formatSessionEvent(entry: SessionLogEntry) {
  const parts = [
    `[session] ${entry.timestamp}`,
    `session=${entry.sessionId}`,
    `event=${entry.eventType}`,
    `summary=${entry.summary}`,
  ];

  if (entry.detail) {
    parts.push(`detail=${entry.detail}`);
  }

  return parts.join(" ");
}

function pollSessionStream(
  root: string,
  sessionId: string,
  cursor: SessionStreamCursor,
  writeLine: (line: string) => void,
) {
  const sessionEventsPath = resolveSessionEventsPath(root, sessionId);
  if (!existsSync(sessionEventsPath)) {
    return;
  }

  const contents = readFileSync(sessionEventsPath, "utf8");
  if (contents.length < cursor.eventsOffset) {
    cursor.eventsOffset = 0;
  }

  const nextChunk = contents.slice(cursor.eventsOffset);
  cursor.eventsOffset = contents.length;

  for (const line of nextChunk.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }

    try {
      const entry = parseSessionEvent(line);
      if (!entry) {
        writeLine("[session] invalid_event");
        continue;
      }

      writeLine(formatSessionEvent(entry));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      writeLine(`[session] read_error detail=${detail}`);
    }
  }
}

function pollDaemonStream(
  root: string,
  cursor: DaemonStreamCursor,
  writeLine: (line: string) => void,
) {
  const runtimeState = readRuntimeState(root);
  const runtimeFingerprint = resolveRuntimeFingerprint(runtimeState);
  if (runtimeFingerprint !== cursor.runtimeFingerprint) {
    cursor.runtimeFingerprint = runtimeFingerprint;
    writeLine(formatRuntimeState(runtimeState));
  }

  const daemonLogPath = resolveDaemonLogPath(root);
  if (existsSync(daemonLogPath)) {
    const daemonContents = readFileSync(daemonLogPath, "utf8");
    if (daemonContents.length < cursor.daemonOffset) {
      cursor.daemonOffset = 0;
    }

    const nextChunk = daemonContents.slice(cursor.daemonOffset);
    cursor.daemonOffset = daemonContents.length;

    for (const line of nextChunk.split(/\r?\n/)) {
      if (line.trim().length === 0) {
        continue;
      }

      writeLine(`[daemon] ${line}`);
    }
  }

  const phaseLogDirectory = resolvePhaseLogDirectory(root);
  if (!existsSync(phaseLogDirectory)) {
    return;
  }

  const phaseFiles = readdirSync(phaseLogDirectory)
    .filter((entry) => entry.endsWith(".json"))
    .sort();

  for (const phaseFile of phaseFiles) {
    if (cursor.seenPhaseFiles.has(phaseFile)) {
      continue;
    }
    cursor.seenPhaseFiles.add(phaseFile);

    const phasePath = path.join(phaseLogDirectory, phaseFile);
    try {
      const entry = parsePhaseEntry(readFileSync(phasePath, "utf8"));
      if (!entry) {
        writeLine(`[phase] invalid_entry file=${phaseFile}`);
        continue;
      }

      writeLine(formatPhaseEntry(entry));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      writeLine(`[phase] read_error file=${phaseFile} detail=${detail}`);
    }
  }
}

function defaultSleep(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (milliseconds <= 0) {
      resolve();
      return;
    }

    let finished = false;
    const timer = setTimeout(() => {
      if (finished) {
        return;
      }

      finished = true;
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, milliseconds);

    const onAbort = () => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timer);
      resolve();
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export async function streamDaemonView(
  root = process.cwd(),
  options: StreamDaemonOptions = {},
) {
  const resolvedRoot = path.resolve(root);
  const writeLine = options.writeLine ?? ((line: string) => {
    console.log(line);
  });
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPolls = options.maxPolls ?? Number.POSITIVE_INFINITY;
  const sleep = options.sleep ?? defaultSleep;
  const cursor = initializeCursor(resolvedRoot);

  writeLine(`Streaming daemon view from ${resolvedRoot}. Press Ctrl+C to stop.`);

  for (let pollIndex = 0; pollIndex < maxPolls; pollIndex += 1) {
    if (options.signal?.aborted) {
      break;
    }

    pollDaemonStream(resolvedRoot, cursor, writeLine);
    if (pollIndex === maxPolls - 1) {
      break;
    }

    await sleep(pollIntervalMs, options.signal);
  }
}

export async function streamSessionView(
  root = process.cwd(),
  sessionId: string,
  options: StreamDaemonOptions = {},
) {
  const resolvedRoot = path.resolve(root);
  const writeLine = options.writeLine ?? ((line: string) => {
    console.log(line);
  });
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPolls = options.maxPolls ?? Number.POSITIVE_INFINITY;
  const sleep = options.sleep ?? defaultSleep;
  const cursor = initializeSessionCursor(resolvedRoot, sessionId);

  writeLine(`Streaming session ${sessionId} from ${resolvedRoot}. Press Ctrl+C to stop.`);

  for (let pollIndex = 0; pollIndex < maxPolls; pollIndex += 1) {
    if (options.signal?.aborted) {
      break;
    }

    pollSessionStream(resolvedRoot, sessionId, cursor, writeLine);

    const snapshot = readSessionReport(resolvedRoot, sessionId);
    if (snapshot && snapshot.status !== "running") {
      const parts = [
        "[session]",
        `session=${snapshot.sessionId}`,
        `status=${snapshot.status}`,
      ];
      if (snapshot.error) {
        parts.push(`error=${snapshot.error}`);
      }
      if (snapshot.finishedAt) {
        parts.push(`finished=${snapshot.finishedAt}`);
      }
      writeLine(parts.join(" "));
      break;
    }

    if (pollIndex === maxPolls - 1) {
      break;
    }

    await sleep(pollIntervalMs, options.signal);
  }
}
