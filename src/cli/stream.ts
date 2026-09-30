import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";

import { readRuntimeState, type RuntimeStateRecord } from "./runtime-state.js";
import type { PhaseLogEntry } from "../core/phase-log.js";
import { resolveSessionStreamDirectory } from "../runtime/session-report.js";

const DEFAULT_POLL_INTERVAL_MS = 500;

export interface StreamDaemonOptions {
  pollIntervalMs?: number;
  maxPolls?: number;
  signal?: AbortSignal;
  writeLine?: (line: string) => void;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

interface FileTail {
  /** Byte offset already streamed. */
  offset: number;
  /** Trailing partial line held until its newline arrives. */
  pendingText: string;
}

interface SessionStreamTail extends FileTail {
  /** `issue/caste` from the stream's start line, or a short session id. */
  label: string;
}

interface DaemonStreamCursor {
  daemon: FileTail;
  sessionStreams: Map<string, SessionStreamTail>;
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

function fileSize(filePath: string) {
  return existsSync(filePath) ? statSync(filePath).size : 0;
}

function listSessionStreamFiles(root: string) {
  const directory = resolveSessionStreamDirectory(root);
  return existsSync(directory)
    ? readdirSync(directory).filter((entry) => entry.endsWith(".log")).sort()
    : [];
}

const SESSION_START_PATTERN = /\[session\] start issue=(\S+) caste=(\S+)/;

function readSessionStreamLabel(fileName: string, firstLine: string | undefined) {
  const match = firstLine ? SESSION_START_PATTERN.exec(firstLine) : null;
  return match ? `${match[1]}/${match[2]}` : fileName.replace(/\.log$/, "").slice(0, 8);
}

function readFirstLine(filePath: string) {
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(512);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, bytesRead).split(/\r?\n/)[0];
  } finally {
    closeSync(fd);
  }
}

function initializeCursor(root: string): DaemonStreamCursor {
  const phaseLogDirectory = resolvePhaseLogDirectory(root);
  const streamDirectory = resolveSessionStreamDirectory(root);
  const sessionStreams = new Map<string, SessionStreamTail>();
  for (const fileName of listSessionStreamFiles(root)) {
    const filePath = path.join(streamDirectory, fileName);
    sessionStreams.set(fileName, {
      offset: fileSize(filePath),
      pendingText: "",
      label: readSessionStreamLabel(fileName, readFirstLine(filePath)),
    });
  }

  return {
    daemon: { offset: fileSize(resolveDaemonLogPath(root)), pendingText: "" },
    sessionStreams,
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

/** Reads only bytes appended since the last poll; restarts if the file was truncated. */
function readAppendedLines(filePath: string, tail: FileTail) {
  if (!existsSync(filePath)) {
    return [];
  }

  const size = statSync(filePath).size;
  if (size < tail.offset) {
    tail.offset = 0;
    tail.pendingText = "";
  }
  if (size === tail.offset) {
    return [];
  }

  const buffer = Buffer.alloc(size - tail.offset);
  const fd = openSync(filePath, "r");
  try {
    readSync(fd, buffer, 0, buffer.length, tail.offset);
  } finally {
    closeSync(fd);
  }
  tail.offset = size;

  const lines = `${tail.pendingText}${buffer.toString("utf8")}`.split(/\r?\n/);
  tail.pendingText = lines.pop() ?? "";
  return lines.filter((line) => line.trim().length > 0);
}

/**
 * Streams live adapter activity from `.aegis/logs/session-streams/`, labelled
 * by issue and caste. Lines start with an ISO timestamp, so concurrent
 * sessions interleave chronologically.
 */
function pollSessionStreams(
  root: string,
  cursor: DaemonStreamCursor,
  writeLine: (line: string) => void,
) {
  const streamDirectory = resolveSessionStreamDirectory(root);
  const appended: Array<{ line: string; labelled: string }> = [];
  for (const fileName of listSessionStreamFiles(root)) {
    let tail = cursor.sessionStreams.get(fileName);
    if (!tail) {
      tail = { offset: 0, pendingText: "", label: readSessionStreamLabel(fileName, undefined) };
      cursor.sessionStreams.set(fileName, tail);
    }

    for (const line of readAppendedLines(path.join(streamDirectory, fileName), tail)) {
      const match = SESSION_START_PATTERN.exec(line);
      if (match) {
        tail.label = `${match[1]}/${match[2]}`;
      }
      appended.push({ line, labelled: `[session ${tail.label}] ${line}` });
    }
  }

  appended.sort((left, right) => (left.line < right.line ? -1 : left.line > right.line ? 1 : 0));
  for (const entry of appended) {
    writeLine(entry.labelled);
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

  for (const line of readAppendedLines(resolveDaemonLogPath(root), cursor.daemon)) {
    writeLine(`[daemon] ${line}`);
  }

  pollSessionStreams(root, cursor, writeLine);

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
