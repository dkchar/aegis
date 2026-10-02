import path from "node:path";

import { createJsonExclusive } from "../shared/atomic-write.js";

export type PhaseName = "poll" | "triage" | "dispatch" | "monitor" | "reap";

export interface PhaseLogEntry {
  timestamp: string;
  phase: PhaseName;
  issueId: string;
  action: string;
  outcome: string;
  sessionId?: string;
  detail?: string;
}

export function resolvePhaseLogDirectory(root: string) {
  return path.join(path.resolve(root), ".aegis", "logs", "phases");
}

function sanitizeFileNamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

/**
 * Persists one phase event as `<timestamp>-<phase>-<issue>.json`. Names are
 * timestamp-sortable; entries that share a name get a `~N` suffix instead of
 * overwriting each other.
 */
export function writePhaseLog(root: string, entry: PhaseLogEntry) {
  const fileName = [
    entry.timestamp.replaceAll(":", "-"),
    entry.phase,
    sanitizeFileNamePart(entry.issueId),
  ].join("-");
  return createJsonExclusive(path.join(resolvePhaseLogDirectory(root), `${fileName}.json`), entry);
}

export type PhaseLogWriter = (root: string, entry: PhaseLogEntry) => void;

export const writePhaseLogEntry: PhaseLogWriter = (root, entry) => {
  writePhaseLog(root, entry);
};

/**
 * Writer for the daemon's per-cycle `_all` summaries. A summary identical to
 * the previous one for the same phase and action is skipped, so an idle daemon
 * stops adding files every poll while every change is still recorded.
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
