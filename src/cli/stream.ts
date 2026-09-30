import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";

import { readRuntimeState, type RuntimeStateRecord } from "./runtime-state.js";
import type { PhaseLogEntry } from "../core/phase-log.js";

const DEFAULT_POLL_INTERVAL_MS = 500;

export interface StreamDaemonOptions {
  pollIntervalMs?: number;
  maxPolls?: number;
  signal?: AbortSignal;
  writeLine?: (line: string) => void;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

interface DaemonStreamCursor {
  /** Byte offset into daemon.log already streamed. */
  daemonOffset: number;
  /** Trailing partial line held until its newline arrives. */
  pendingDaemonText: string;
  seenPhaseFiles: Set<string>;
  runtimeFingerprint: string | null;
}

function resolveDaemonLogPath(root: string) {
  return path.join(path.resolve(root), ".aegis", "logs", "daemon.log");
}

function resolvePhaseLogDirectory(root: string) {
  return path.join(path.resolve(root), ".aegis", "logs", "phases");
}

function resolveRuntimeFingerprint(state: RuntimeStateRecord | null) {
  return state ? JSON.stringify(state) : "runtime:none";
}

function initializeCursor(root: string): DaemonStreamCursor {
  const daemonLogPath = resolveDaemonLogPath(root);
  const phaseLogDirectory = resolvePhaseLogDirectory(root);

  return {
    daemonOffset: existsSync(daemonLogPath) ? statSync(daemonLogPath).size : 0,
    pendingDaemonText: "",
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
    `[phase] ${entry.timestamp}`,
    `phase=${entry.phase}`,
    `issue=${entry.issueId}`,
    `action=${entry.action}`,
    `outcome=${entry.outcome}`,
  ];

  if (entry.sessionId) {
    parts.push(`session=${entry.sessionId}`);
  }
  if (entry.detail) {
    parts.push(`detail=${entry.detail}`);
  }

  return parts.join(" ");
}

/** Reads only bytes appended since the last poll; restarts if the log was truncated. */
function readAppendedDaemonLines(daemonLogPath: string, cursor: DaemonStreamCursor) {
  if (!existsSync(daemonLogPath)) {
    return [];
  }

  const size = statSync(daemonLogPath).size;
  if (size < cursor.daemonOffset) {
    cursor.daemonOffset = 0;
    cursor.pendingDaemonText = "";
  }
  if (size === cursor.daemonOffset) {
    return [];
  }

  const buffer = Buffer.alloc(size - cursor.daemonOffset);
  const fd = openSync(daemonLogPath, "r");
  try {
    readSync(fd, buffer, 0, buffer.length, cursor.daemonOffset);
  } finally {
    closeSync(fd);
  }
  cursor.daemonOffset = size;

  const lines = `${cursor.pendingDaemonText}${buffer.toString("utf8")}`.split(/\r?\n/);
  cursor.pendingDaemonText = lines.pop() ?? "";
  return lines.filter((line) => line.trim().length > 0);
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

  for (const line of readAppendedDaemonLines(resolveDaemonLogPath(root), cursor)) {
    writeLine(`[daemon] ${line}`);
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
