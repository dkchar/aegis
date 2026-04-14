import { execFile } from "node:child_process";

import type { TrackerClient, TrackerReadyIssue } from "./tracker.js";

interface RawBeadsIssue {
  id?: unknown;
  title?: unknown;
}

function normalizeReadyIssue(issue: RawBeadsIssue, index: number): TrackerReadyIssue {
  const id = typeof issue.id === "string" && issue.id.trim().length > 0
    ? issue.id
    : `unknown-${index}`;
  const title = typeof issue.title === "string" && issue.title.trim().length > 0
    ? issue.title
    : id;

  return { id, title };
}

export class BeadsTrackerClient implements TrackerClient {
  async listReadyIssues(root = process.cwd()): Promise<TrackerReadyIssue[]> {
    return new Promise((resolve, reject) => {
      execFile(
        "bd",
        ["ready", "--json"],
        {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            const detail = stderr?.trim() ? ` ${stderr.trim()}` : "";
            reject(new Error(`bd ready failed:${detail}`));
            return;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(stdout);
          } catch (parseError) {
            const detail = parseError instanceof Error ? parseError.message : String(parseError);
            reject(new Error(`bd ready returned invalid JSON: ${detail}`));
            return;
          }

          if (!Array.isArray(parsed)) {
            reject(new Error("bd ready returned a non-array payload"));
            return;
          }

          resolve(parsed.map((issue, index) => normalizeReadyIssue(issue as RawBeadsIssue, index)));
        },
      );
    });
  }
}
