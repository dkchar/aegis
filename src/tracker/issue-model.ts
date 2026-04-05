/**
 * Canonical issue model — the internal representation Aegis uses when working
 * with Beads issues.
 *
 * SPECv2 §5: Aegis tracks seven functional issue classes and a shared lifecycle
 * type.  This module defines the shapes that flow through the orchestration
 * core; it does not define Beads wire types.
 */

// ---------------------------------------------------------------------------
// Issue classes (SPECv2 §5.1)
// ---------------------------------------------------------------------------

/**
 * The functional class of a Beads issue as understood by Aegis.
 *
 * - `primary`      — work the human or planner wants implemented
 * - `sub`          — decomposition artifact from Oracle/Prometheus
 * - `fix`          — corrective work from Sentinel or failed merge gates
 * - `conflict`     — explicit rework or intervention artifact from the merge queue
 * - `escalation`   — human-decision artifact; requires explicit resolution
 * - `clarification`— a blocking question that must be answered before work continues
 * - `message`      — `type=message` Beads issue used for system signaling
 */
export type WorkIssueClass =
  | "primary"
  | "sub"
  | "fix"
  | "conflict"
  | "escalation"
  | "clarification"
  | "message";

// ---------------------------------------------------------------------------
// Issue lifecycle (SPECv2 §5.2)
// ---------------------------------------------------------------------------

/**
 * The Beads-level status of an issue.
 *
 * Aegis does not infer orchestration stage from these values; it reads them
 * only to understand whether the issue is available for dispatch.
 */
export type IssueStatus = "open" | "in_progress" | "closed";

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

/** Numeric priority from Beads (lower value = higher priority). */
export type IssuePriority = 1 | 2 | 3 | 4 | 5;

// ---------------------------------------------------------------------------
// Canonical issue shape
// ---------------------------------------------------------------------------

/**
 * The internal representation of a Beads issue inside Aegis.
 *
 * This is what flows through the dispatch loop and all orchestration logic.
 * It is not a direct serialisation of any Beads API payload.
 */
export interface AegisIssue {
  /** Beads issue identifier (e.g. "aegis-fjm.5"). */
  id: string;

  /** Short title as provided in Beads. */
  title: string;

  /** Full description text, or null if empty. */
  description: string | null;

  /** Functional class assigned by Aegis. */
  issueClass: WorkIssueClass;

  /** Current Beads-level status. */
  status: IssueStatus;

  /** Priority (lower = higher priority). */
  priority: IssuePriority;

  /**
   * Identifiers of issues that must be closed before this one is ready.
   * Empty when there are no open blockers.
   */
  blockers: string[];

  /**
   * The Beads ID of the issue this was generated from, or null for
   * top-level issues.
   */
  parentId: string | null;

  /**
   * IDs of issues generated from this issue (sub-issues, fix issues, etc.).
   */
  childIds: string[];

  /** Labels from Beads, preserved verbatim. */
  labels: string[];

  /** ISO-8601 creation timestamp. */
  createdAt: string;

  /** ISO-8601 last-updated timestamp. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Ready-queue entry
// ---------------------------------------------------------------------------

/**
 * A lightweight projection of an AegisIssue used for dispatch ordering.
 *
 * The dispatch loop works with ReadyIssue slices to avoid loading full
 * issue bodies when only scheduling metadata is needed.
 */
export interface ReadyIssue {
  id: string;
  title: string;
  issueClass: WorkIssueClass;
  priority: IssuePriority;
}

// ---------------------------------------------------------------------------
// Generated-issue creation input
// ---------------------------------------------------------------------------

/**
 * Minimal input required to create a generated Beads issue.
 */
export interface CreateIssueInput {
  title: string;
  description: string;
  issueClass: WorkIssueClass;
  priority: IssuePriority;
  /** The issue this new one is generated from, if any. */
  originId: string | null;
  /** Labels to attach. */
  labels: string[];
}

/**
 * Input for updating an existing issue.
 *
 * All fields are optional; only provided fields are changed.
 */
export interface UpdateIssueInput {
  title?: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  labels?: string[];
}
