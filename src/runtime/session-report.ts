import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { RuntimeSessionSnapshot } from "./agent-runtime.js";

function resolveSessionsDirectory(root: string) {
  return path.join(path.resolve(root), ".aegis", "logs", "sessions");
}

export function resolveSessionReportPath(root: string, sessionId: string) {
  return path.join(resolveSessionsDirectory(root), `${sessionId}.json`);
}

export function writeSessionReport(
  root: string,
  report: RuntimeSessionSnapshot,
) {
  const reportPath = resolveSessionReportPath(root, report.sessionId);
  const temporaryPath = `${reportPath}.tmp`;
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, reportPath);
}

export function readSessionReport(
  root: string,
  sessionId: string,
): RuntimeSessionSnapshot | null {
  const reportPath = resolveSessionReportPath(root, sessionId);

  if (!existsSync(reportPath)) {
    return null;
  }

  return JSON.parse(readFileSync(reportPath, "utf8")) as RuntimeSessionSnapshot;
}
