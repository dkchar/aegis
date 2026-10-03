import { appendFileSync, closeSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";

export type PhaseName = "poll" | "triage" | "dispatch" | "monitor" | "reap" | "merge";

export interface PhaseLogEntry {
  timestamp: string;
  phase: PhaseName;
  issueId: string;
  action: string;
  outcome: string;
  sessionId?: string;
  detail?: string;
}

export interface PhaseLogRead {
  entries: PhaseLogEntry[];
  /** Byte offset after the last complete line; pass back to read only newer entries. */
  offset: number;
}

const PHASE_NAMES: ReadonlySet<string> = new Set<PhaseName>(["poll", "triage", "dispatch", "monitor", "reap", "merge"]);

/**
 * The loop event log: one JSON object per line, appended in write order.
 * Append-only, so a reader's byte offset is a durable cursor.
 */
export function resolvePhaseLogPath(root: string) {
  return path.join(path.resolve(root), ".aegis", "logs", "phases.jsonl");
}

export function writePhaseLog(root: string, entry: PhaseLogEntry) {
  const logPath = resolvePhaseLogPath(root);
  mkdirSync(path.dirname(logPath), { recursive: true });
  // One write per line: O_APPEND keeps concurrent lines whole and ordered.
  appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}

export type PhaseLogWriter = (root: string, entry: PhaseLogEntry) => void;

export const writePhaseLogEntry: PhaseLogWriter = (root, entry) => {
  writePhaseLog(root, entry);
};

/**
 * Writer for the daemon's per-cycle `_all` summaries. A summary identical to
 * the previous one for the same phase and action is skipped, so an idle daemon
 * stops growing the log every poll while every change is still recorded.
 * Issue-level events never go through this writer.
 */
export function createCycleSummaryWriter(): PhaseLogWriter {
  const lastSummaryByKey = new Map<string, string>();
  return (root, entry) => {
    const key = [path.resolve(root), entry.phase, entry.action].join("\n");
    const summary = JSON.stringify([entry.outcome, entry.sessionId ?? null, entry.detail ?? null]);
    if (lastSummaryByKey.get(key) === summary) {
      return;
    }
    lastSummaryByKey.set(key, summary);
    writePhaseLog(root, entry);
  };
}

/** Validates one parsed log line; malformed lines yield `null`. */
export function parsePhaseLogEntry(value: unknown): PhaseLogEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate["timestamp"] !== "string"
    || typeof candidate["phase"] !== "string"
    || !PHASE_NAMES.has(candidate["phase"])
    || typeof candidate["issueId"] !== "string"
    || typeof candidate["action"] !== "string"
    || typeof candidate["outcome"] !== "string"
  ) {
    return null;
  }

  return {
    timestamp: candidate["timestamp"],
    phase: candidate["phase"] as PhaseName,
    issueId: candidate["issueId"],
    action: candidate["action"],
    outcome: candidate["outcome"],
    ...(typeof candidate["sessionId"] === "string" ? { sessionId: candidate["sessionId"] } : {}),
    ...(typeof candidate["detail"] === "string" ? { detail: candidate["detail"] } : {}),
  };
}

function parseLine(line: string) {
  try {
    return parsePhaseLogEntry(JSON.parse(line));
  } catch {
    return null;
  }
}

/**
 * Reads complete entries appended after `fromOffset`. A trailing line still
 * being written is left for the next read; a log shorter than `fromOffset`
 * (truncated or replaced) is read from the start.
 */
export function readPhaseLog(root: string, fromOffset = 0): PhaseLogRead {
  const logPath = resolvePhaseLogPath(root);
  let size: number;
  try {
    size = statSync(logPath).size;
  } catch {
    return { entries: [], offset: 0 };
  }

  const start = size < fromOffset ? 0 : fromOffset;
  if (size === start) {
    return { entries: [], offset: start };
  }

  const buffer = Buffer.alloc(size - start);
  const fd = openSync(logPath, "r");
  try {
    readSync(fd, buffer, 0, buffer.length, start);
  } finally {
    closeSync(fd);
  }

  const lastNewline = buffer.lastIndexOf(0x0a);
  if (lastNewline === -1) {
    return { entries: [], offset: start };
  }

  const entries = buffer
    .toString("utf8", 0, lastNewline)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseLine)
    .filter((entry): entry is PhaseLogEntry => entry !== null);
  return { entries, offset: start + lastNewline + 1 };
}
