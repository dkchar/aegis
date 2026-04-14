import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface PhaseLogEntry {
  timestamp: string;
  phase: "poll" | "triage" | "dispatch" | "monitor" | "reap";
  issueId: string;
  action: string;
  outcome: string;
  sessionId?: string;
  detail?: string;
}

function resolvePhaseLogDirectory(root: string) {
  return path.join(path.resolve(root), ".aegis", "logs", "phases");
}

export function writePhaseLog(root: string, entry: PhaseLogEntry) {
  const directory = resolvePhaseLogDirectory(root);
  const safeTimestamp = entry.timestamp.replaceAll(":", "-");
  const filename = `${safeTimestamp}-${entry.phase}-${entry.issueId}.json`;
  const logPath = path.join(directory, filename);
  const temporaryPath = `${logPath}.tmp`;

  mkdirSync(directory, { recursive: true });
  writeFileSync(temporaryPath, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, logPath);
}
