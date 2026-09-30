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
