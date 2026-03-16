// src/beads.ts
// Thin wrapper over the bd (beads) CLI.
// All bd CLI interactions in Aegis go through this module.

import { execFile } from "node:child_process";
import type { BeadsIssue, BeadsComment, IssueStatus } from "./types.js";

// Raw shape returned by the bd CLI (uses issue_type, not type; no comments field by default)
interface RawBeadsIssue {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  issue_type?: string;
  type?: string;
  comments?: Array<{
    // bd show returns `text`; older/mock responses may use `body`
    id: string | number;
    text?: string;
    body?: string;
    author: string;
    created_at: string;
  }>;
  [key: string]: unknown;
}

const VALID_STATUSES: readonly IssueStatus[] = [
  "open",
  "ready",
  "in_progress",
  "closed",
  "deferred",
];

function isValidStatus(s: string): s is IssueStatus {
  return (VALID_STATUSES as readonly string[]).includes(s);
}

function mapIssue(raw: RawBeadsIssue): BeadsIssue {
  const comments: BeadsComment[] = (raw.comments ?? []).map((c) => ({
    // bd show returns `text`; fall back to `body` for compatibility with tests/mocks
    id: String(c.id),
    body: c.text ?? c.body ?? "",
    author: c.author,
    created_at: c.created_at,
  }));
  if (!isValidStatus(raw.status)) {
    throw new Error(
      `Unexpected issue status from bd CLI: "${raw.status}" (expected one of: ${VALID_STATUSES.join(", ")})`
    );
  }
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description ?? "",
    type: raw.issue_type ?? raw.type ?? "task",
    priority: raw.priority,
    status: raw.status,
    comments,
  };
}

function parseJson<T>(raw: string, cmd: string): T {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`Empty output from bd ${cmd}`);
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`Malformed JSON from bd ${cmd}:\n${trimmed}`);
  }
}

function runBd(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("bd", args, (error, stdout, stderr) => {
      if (error) {
        const nodeErr = error as NodeJS.ErrnoException;
        if (nodeErr.code === "ENOENT") {
          reject(
            new Error(
              "bd CLI not found in PATH. Install beads (see SPEC §11.1 for instructions)."
            )
          );
        } else {
          reject(
            new Error(
              `bd command failed (${args[0] ?? ""}): ${stderr || error.message}`
            )
          );
        }
        return;
      }
      resolve(stdout);
    });
  });
}

export async function ready(): Promise<BeadsIssue[]> {
  const output = await runBd(["ready", "--json"]);
  const raw = parseJson<RawBeadsIssue[]>(output, "ready");
  return raw.map(mapIssue);
}

export async function show(id: string): Promise<BeadsIssue> {
  const output = await runBd(["show", id, "--json"]);
  // bd show may return a single object or an array — handle both
  const raw = parseJson<RawBeadsIssue | RawBeadsIssue[]>(
    output,
    `show ${id}`
  );
  if (Array.isArray(raw)) {
    const found = raw.find((i) => i.id === id);
    if (!found) {
      throw new Error(`Issue ${id} not found in bd show output`);
    }
    return mapIssue(found);
  }
  return mapIssue(raw);
}

export async function create(opts: {
  title: string;
  description?: string;
  type?: string;
  priority?: number;
}): Promise<BeadsIssue> {
  const args = ["create", opts.title, "--json"];
  if (opts.description !== undefined) {
    args.push(`--description=${opts.description}`);
  }
  if (opts.type !== undefined) {
    args.push("-t", opts.type);
  }
  if (opts.priority !== undefined) {
    args.push("-p", String(opts.priority));
  }
  const output = await runBd(args);
  const raw = parseJson<RawBeadsIssue>(output, "create");
  return mapIssue(raw);
}

export async function update(
  id: string,
  opts: { claim?: boolean; blockedBy?: string; priority?: number }
): Promise<BeadsIssue> {
  const args = ["update", id, "--json"];
  if (opts.claim) {
    args.push("--claim");
  }
  if (opts.blockedBy !== undefined) {
    args.push("--blocked-by", opts.blockedBy);
  }
  if (opts.priority !== undefined) {
    args.push("-p", String(opts.priority));
  }
  const output = await runBd(args);
  const raw = parseJson<RawBeadsIssue>(output, `update ${id}`);
  return mapIssue(raw);
}

export async function close(id: string, reason: string): Promise<BeadsIssue> {
  const output = await runBd(["close", id, "--reason", reason, "--json"]);
  const raw = parseJson<RawBeadsIssue>(output, `close ${id}`);
  return mapIssue(raw);
}

export async function comment(id: string, text: string): Promise<void> {
  // bd comments add <id> <text>  — does not return JSON; output is confirmation text.
  // Errors (e.g., bd not found, non-zero exit) are still propagated by runBd.
  await runBd(["comments", "add", id, text]);
}

export async function list(): Promise<BeadsIssue[]> {
  // "bd list --json" does not return JSON in v0.59+.
  // Use "bd query" which reliably returns JSON and includes all non-deferred issues.
  const output = await runBd(["query", "status!=deferred", "--json"]);
  const raw = parseJson<RawBeadsIssue[]>(output, "query status!=deferred");
  return raw.map(mapIssue);
}
