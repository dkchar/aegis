/**
 * Beads tracker client interface and CLI implementation.
 *
 * Defines the operations Aegis needs from Beads so the orchestration core
 * remains decoupled from the specific CLI surface or future API transport.
 *
 * BeadsCliClient wraps the `bd` CLI, invoking it as a subprocess and mapping
 * its JSON output to the Aegis issue model (SPECv2 §4.1, §5).
 */

import { execFile } from "node:child_process";
import type {
  AegisIssue,
  ReadyIssue,
  CreateIssueInput,
  UpdateIssueInput,
  WorkIssueClass,
  IssueStatus,
  IssuePriority,
} from "./issue-model.js";

// ---------------------------------------------------------------------------
// Tracker client interface
// ---------------------------------------------------------------------------

/**
 * The minimal surface Aegis uses to interact with the Beads issue tracker.
 *
 * All methods return Promises so the interface is compatible with both CLI
 * subprocess implementations and future HTTP-based adapters.
 */
export interface BeadsClient {
  /**
   * Fetch a single issue by its Beads identifier.
   *
   * @throws If the issue does not exist or the tracker is unreachable.
   */
  getIssue(id: string): Promise<AegisIssue>;

  /**
   * Return the current ready queue: issues with no open blockers.
   *
   * The returned list is ordered by priority (ascending, i.e. P1 first).
   */
  getReadyQueue(): Promise<ReadyIssue[]>;

  /**
   * Create a new issue in Beads and return it as an AegisIssue.
   *
   * @param input - The fields for the new issue.
   * @returns The created issue with its assigned Beads identifier.
   */
  createIssue(input: CreateIssueInput): Promise<AegisIssue>;

  /**
   * Apply a partial update to an existing issue.
   *
   * @param id - The Beads issue identifier.
   * @param input - Fields to change; unspecified fields are preserved.
   * @returns The updated issue.
   */
  updateIssue(id: string, input: UpdateIssueInput): Promise<AegisIssue>;

  /**
   * Close an issue, recording an optional reason.
   *
   * @param id - The Beads issue identifier.
   * @param reason - Human-readable explanation, surfaced in Beads.
   * @returns The closed issue.
   */
  closeIssue(id: string, reason?: string): Promise<AegisIssue>;

  /**
   * Record that `childId` was generated from `parentId`.
   *
   * Implementations must use a structured Beads link operation — never
   * informal comment text (SPECv2 §4.1).
   *
   * @param parentId - The originating issue.
   * @param childId  - The derived issue.
   */
  linkIssue(parentId: string, childId: string): Promise<void>;

  /**
   * Remove a previously recorded parent-child origin link.
   */
  unlinkIssue(parentId: string, childId: string): Promise<void>;

  /**
   * Add a blocker dependency so `blockedId` does not appear in `bd ready`
   * until `blockerId` is resolved.
   */
  addBlocker(blockedId: string, blockerId: string): Promise<void>;

  /**
   * Remove a blocker dependency previously created with `addBlocker`.
   */
  removeBlocker(blockedId: string, blockerId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// bd JSON → Aegis model mapping
// ---------------------------------------------------------------------------

/** Known issue-class labels in priority order. */
const CLASS_LABELS: readonly WorkIssueClass[] = [
  "fix",
  "conflict",
  "escalation",
  "clarification",
  "sub",
  "message",
];

function isStructuredIssueClass(value: string): value is WorkIssueClass {
  return CLASS_LABELS.includes(value as WorkIssueClass);
}

/**
 * Infer the WorkIssueClass from bd labels and issue_type.
 *
 * If `issue_type` is one of the structured Aegis classes, returns it directly.
 * Otherwise scans labels for a recognised class keyword.
 * Falls back to "primary".
 */
function inferIssueClass(
  labels: string[],
  issueType: string,
): WorkIssueClass {
  if (isStructuredIssueClass(issueType)) {
    return issueType;
  }
  const labelSet = new Set(labels);
  for (const cls of CLASS_LABELS) {
    if (labelSet.has(cls)) return cls;
  }
  return "primary";
}

/** Clamp a numeric priority to the IssuePriority range. */
function clampPriority(p: number): IssuePriority {
  return Math.max(1, Math.min(5, Math.round(p))) as IssuePriority;
}

/** Normalise bd status strings to the IssueStatus union. */
function normaliseStatus(status: string): IssueStatus {
  if (status === "closed") return "closed";
  if (status === "in_progress") return "in_progress";
  return "open";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BdIssue = Record<string, any>;

/**
 * Map a raw bd JSON issue object to an AegisIssue.
 * Exported for direct unit testing.
 */
export function mapBdIssueToAegis(bd: BdIssue): AegisIssue {
  const deps: BdIssue[] = bd.dependencies ?? [];
  const dependents: BdIssue[] = bd.dependents ?? [];

  // Blockers: dependencies of type "blocks" that are not yet closed.
  const blockers = deps
    .filter(
      (d) =>
        d.dependency_type === "blocks" && d.status !== "closed",
    )
    .map((d) => String(d.id));

  // Children: dependents of type "parent-child".
  const childIds = dependents
    .filter((d) => d.dependency_type === "parent-child")
    .map((d) => String(d.id));

  return {
    id: String(bd.id),
    title: String(bd.title ?? ""),
    description: bd.description ? String(bd.description) : null,
    issueClass: inferIssueClass(bd.labels ?? [], bd.issue_type ?? "task"),
    status: normaliseStatus(bd.status ?? "open"),
    priority: clampPriority(bd.priority ?? 3),
    blockers,
    parentId: bd.parent ? String(bd.parent) : null,
    childIds,
    labels: (bd.labels ?? []).map(String),
    createdAt: String(bd.created_at ?? ""),
    updatedAt: String(bd.updated_at ?? ""),
  };
}

/**
 * Map a raw bd JSON issue to a ReadyIssue (lightweight projection).
 * Exported for direct unit testing.
 */
export function mapBdIssueToReady(bd: BdIssue): ReadyIssue {
  return {
    id: String(bd.id),
    title: String(bd.title ?? ""),
    issueClass: inferIssueClass(bd.labels ?? [], bd.issue_type ?? "task"),
    priority: clampPriority(bd.priority ?? 3),
  };
}

// ---------------------------------------------------------------------------
// CLI executor type
// ---------------------------------------------------------------------------

/**
 * Function that runs a `bd` command and returns stdout.
 * Abstracted so tests can inject a mock without spawning processes.
 */
export type BdExecutor = (args: string[]) => Promise<string>;

/** Default executor: runs `bd` as a child process. */
function defaultBdExecutor(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("bd", args, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = stderr?.trim() ? ` — ${stderr.trim()}` : "";
        reject(new Error(`bd ${args[0]} failed: ${err.message}${detail}`));
        return;
      }
      resolve(stdout);
    });
  });
}

// ---------------------------------------------------------------------------
// BeadsCliClient
// ---------------------------------------------------------------------------

/**
 * Concrete BeadsClient that wraps the `bd` CLI.
 *
 * All commands are invoked with `--json` and their stdout is parsed.
 */
export class BeadsCliClient implements BeadsClient {
  private readonly _exec: BdExecutor;

  constructor(executor?: BdExecutor) {
    this._exec = executor ?? defaultBdExecutor;
  }

  async getIssue(id: string): Promise<AegisIssue> {
    const raw = await this._exec(["show", id, "--json"]);
    const arr = parseJsonArray(raw, "show");
    if (arr.length === 0) {
      throw new Error(`Issue not found: ${id}`);
    }
    return mapBdIssueToAegis(arr[0]);
  }

  async getReadyQueue(): Promise<ReadyIssue[]> {
    const raw = await this._exec(["ready", "--json"]);
    const arr = parseJsonArray(raw, "ready");
    return arr.map(mapBdIssueToReady);
  }

  async createIssue(input: CreateIssueInput): Promise<AegisIssue> {
    const args: string[] = [
      "create",
      "--title", input.title,
      "--description", input.description,
      "--priority", String(input.priority),
      "--type", input.issueClass === "primary" ? "task" : input.issueClass,
    ];
    if (input.labels.length > 0) {
      args.push("--labels", input.labels.join(","));
    }
    args.push("--json");

    const raw = await this._exec(args);
    const arr = parseJsonArray(raw, "create");
    if (arr.length === 0) {
      throw new Error("bd create returned empty result");
    }
    const created = mapBdIssueToAegis(arr[0]);

    // Link the new issue to its origin if specified (SPECv2 §5.5).
    if (input.originId) {
      try {
        await this.linkIssue(input.originId, created.id);
      } catch (error) {
        let cleanupError: Error | null = null;
        try {
          await this.closeIssue(
            created.id,
            `Failed to link ${created.id} to origin ${input.originId}`,
          );
        } catch (rollbackError) {
          cleanupError = rollbackError as Error;
        }
        if (cleanupError) {
          const surfacedError = new Error(
            `Failed to link ${created.id} to origin ${input.originId}: ${(error as Error).message}; rollback failed to close ${created.id}: ${cleanupError.message}`,
          ) as Error & { createdIssue?: AegisIssue };
          surfacedError.createdIssue = created;
          throw surfacedError;
        }
        throw error;
      }
    }

    return created;
  }

  async updateIssue(id: string, input: UpdateIssueInput): Promise<AegisIssue> {
    const args: string[] = ["update", id];

    if (input.title !== undefined) {
      args.push("--title", input.title);
    }
    if (input.description !== undefined) {
      args.push("--description", input.description);
    }
    if (input.priority !== undefined) {
      args.push("--priority", String(input.priority));
    }
    if (input.labels !== undefined) {
      args.push("--set-labels", input.labels.join(","));
    }
    if (input.status !== undefined) {
      args.push("--status", input.status);
    }
    args.push("--json");

    const raw = await this._exec(args);
    const arr = parseJsonArray(raw, "update");
    if (arr.length === 0) {
      throw new Error(`bd update returned empty result for ${id}`);
    }
    return mapBdIssueToAegis(arr[0]);
  }

  async closeIssue(id: string, reason?: string): Promise<AegisIssue> {
    const args: string[] = ["close", id];
    if (reason !== undefined) {
      args.push("--reason", reason);
    }
    args.push("--json");

    const raw = await this._exec(args);
    const arr = parseJsonArray(raw, "close");
    if (arr.length === 0) {
      throw new Error(`bd close returned empty result for ${id}`);
    }
    return mapBdIssueToAegis(arr[0]);
  }

  async linkIssue(parentId: string, childId: string): Promise<void> {
    // bd link <childId> <parentId> --type parent-child
    // (bd link semantics: second arg blocks first arg; for parent-child we
    // pass the child first so the parent is recorded as the blocker/parent)
    await this._exec([
      "link", childId, parentId, "--type", "parent-child", "--json",
    ]);
  }

  async unlinkIssue(parentId: string, childId: string): Promise<void> {
    await this._exec(["dep", "remove", childId, parentId]);
  }

  async addBlocker(blockedId: string, blockerId: string): Promise<void> {
    await this._exec(["dep", "add", blockedId, blockerId]);
  }

  async removeBlocker(blockedId: string, blockerId: string): Promise<void> {
    await this._exec(["dep", "remove", blockedId, blockerId]);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJsonArray(raw: string, command: string): BdIssue[] {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "null") return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed as BdIssue[];
    // Some bd commands return a single object instead of an array.
    return [parsed as BdIssue];
  } catch {
    throw new Error(
      `Failed to parse JSON from bd ${command}: ${trimmed.slice(0, 200)}`,
    );
  }
}
