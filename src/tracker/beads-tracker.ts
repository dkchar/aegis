import { execFile } from "node:child_process";

import type {
  TrackerClient,
  TrackerCreateIssueInput,
  TrackerLinkInput,
  TrackerReadyIssue,
} from "./tracker.js";
import type { AegisIssue, IssueStatus, WorkIssueClass } from "./issue-model.js";

type ExecFileLike = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    encoding: BufferEncoding;
    maxBuffer: number;
    windowsHide: boolean;
  },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => void;

interface RawBeadsIssue {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  status?: unknown;
  priority?: unknown;
  labels?: unknown;
  dependencies?: unknown;
  parent_id?: unknown;
  child_ids?: unknown;
}

function normalizeIssueId(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  return null;
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

function normalizeStatus(value: unknown): IssueStatus {
  if (
    value === "open"
    || value === "in_progress"
    || value === "closed"
    || value === "blocked"
  ) {
    return value;
  }

  return "open";
}

function normalizeIssueClass(value: RawBeadsIssue): WorkIssueClass {
  void value;
  return "primary";
}

function normalizeDependencies(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      if (
        typeof entry === "object"
        && entry !== null
        && (entry as Record<string, unknown>).type === "blocks"
        && typeof (entry as Record<string, unknown>).id === "string"
      ) {
        return (entry as Record<string, string>).id;
      }

      return null;
    })
    .filter((entry): entry is string => entry !== null);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeIssue(raw: RawBeadsIssue): AegisIssue {
  return {
    id: typeof raw.id === "string" ? raw.id : "unknown",
    title: typeof raw.title === "string" ? raw.title : "unknown",
    description: typeof raw.description === "string" ? raw.description : null,
    issueClass: normalizeIssueClass(raw),
    status: normalizeStatus(raw.status),
    priority: typeof raw.priority === "number" ? raw.priority : 1,
    blockers: normalizeDependencies(raw.dependencies),
    parentId: typeof raw.parent_id === "string" ? raw.parent_id : null,
    childIds: normalizeStringArray(raw.child_ids),
    labels: normalizeStringArray(raw.labels),
  };
}

export class BeadsTrackerClient implements TrackerClient {
  private readonly execFileImpl: ExecFileLike;

  constructor(options: { execFile?: ExecFileLike } = {}) {
    this.execFileImpl = options.execFile ?? execFile;
  }

  async listReadyIssues(root = process.cwd()): Promise<TrackerReadyIssue[]> {
    return new Promise((resolve, reject) => {
      this.execFileImpl(
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

  async getIssue(id: string, root = process.cwd()): Promise<AegisIssue> {
    return new Promise((resolve, reject) => {
      this.execFileImpl(
        "bd",
        ["show", id, "--json"],
        {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            const detail = stderr?.trim() ? ` ${stderr.trim()}` : "";
            reject(new Error(`bd show failed:${detail}`));
            return;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(stdout);
          } catch (parseError) {
            const detail = parseError instanceof Error ? parseError.message : String(parseError);
            reject(new Error(`bd show returned invalid JSON: ${detail}`));
            return;
          }

          const payload = Array.isArray(parsed) ? parsed[0] : parsed;
          if (!payload || typeof payload !== "object") {
            reject(new Error("bd show returned an invalid issue payload"));
            return;
          }

          resolve(normalizeIssue(payload as RawBeadsIssue));
        },
      );
    });
  }

  async closeIssue(id: string, root = process.cwd()): Promise<void> {
    return new Promise((resolve, reject) => {
      this.execFileImpl(
        "bd",
        ["close", id, "--reason", "Completed", "--json"],
        {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            const detail = stderr?.trim() ? ` ${stderr.trim()}` : "";
            reject(new Error(`bd close failed:${detail}`));
            return;
          }

          void stdout;
          resolve();
        },
      );
    });
  }

  async createIssue(
    input: TrackerCreateIssueInput,
    root = process.cwd(),
  ): Promise<string> {
    const args = [
      "create",
      input.title,
      "--description",
      input.description,
      "--json",
    ];

    if (input.dependencies && input.dependencies.length > 0) {
      args.splice(args.length - 1, 0, "--deps", input.dependencies.join(","));
    }

    return new Promise((resolve, reject) => {
      this.execFileImpl(
        "bd",
        args,
        {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            const detail = stderr?.trim() ? ` ${stderr.trim()}` : "";
            reject(new Error(`bd create failed:${detail}`));
            return;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(stdout);
          } catch (parseError) {
            const detail = parseError instanceof Error ? parseError.message : String(parseError);
            reject(new Error(`bd create returned invalid JSON: ${detail}`));
            return;
          }

          const payload = Array.isArray(parsed) ? parsed[0] : parsed;
          if (!payload || typeof payload !== "object") {
            reject(new Error("bd create returned an invalid issue payload"));
            return;
          }

          const issueId = normalizeIssueId((payload as RawBeadsIssue).id);
          if (!issueId) {
            reject(new Error("bd create payload is missing issue id"));
            return;
          }

          resolve(issueId);
        },
      );
    });
  }

  async linkBlockingIssue(input: TrackerLinkInput, root = process.cwd()): Promise<void> {
    return new Promise((resolve, reject) => {
      this.execFileImpl(
        "bd",
        ["link", input.blockingIssueId, input.blockedIssueId, "--type", "blocks"],
        {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        },
        (error, _stdout, stderr) => {
          if (error) {
            const detail = stderr?.trim() ? ` ${stderr.trim()}` : "";
            reject(new Error(`bd link failed:${detail}`));
            return;
          }

          resolve();
        },
      );
    });
  }
}
