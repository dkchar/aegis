/**
 * Beads tracker client interface.
 *
 * Defines the operations Aegis needs from Beads so the orchestration core
 * remains decoupled from the specific CLI surface or future API transport.
 *
 * Lane A (aegis-fjm.5.2) will provide the concrete implementation that
 * invokes the `bd` CLI and maps responses to `AegisIssue` shapes.
 */

import type {
  AegisIssue,
  ReadyIssue,
  CreateIssueInput,
  UpdateIssueInput,
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
}

// ---------------------------------------------------------------------------
// Stub — placeholder until Lane A lands
// ---------------------------------------------------------------------------

/**
 * Placeholder implementation that throws on every call.
 *
 * Replace with the real implementation in Lane A (aegis-fjm.5.2).
 */
export class BeadsClientStub implements BeadsClient {
  private static _notImplemented(method: string): never {
    throw new Error(
      `BeadsClientStub.${method}: not implemented — Lane A (aegis-fjm.5.2) will implement this`,
    );
  }

  getIssue(_id: string): Promise<AegisIssue> {
    return BeadsClientStub._notImplemented("getIssue");
  }

  getReadyQueue(): Promise<ReadyIssue[]> {
    return BeadsClientStub._notImplemented("getReadyQueue");
  }

  createIssue(_input: CreateIssueInput): Promise<AegisIssue> {
    return BeadsClientStub._notImplemented("createIssue");
  }

  updateIssue(_id: string, _input: UpdateIssueInput): Promise<AegisIssue> {
    return BeadsClientStub._notImplemented("updateIssue");
  }

  closeIssue(_id: string, _reason?: string): Promise<AegisIssue> {
    return BeadsClientStub._notImplemented("closeIssue");
  }

  linkIssue(_parentId: string, _childId: string): Promise<void> {
    return BeadsClientStub._notImplemented("linkIssue");
  }
}
