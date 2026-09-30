import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { writeJsonAtomic } from "../shared/atomic-write.js";

export type MergeQueueItemStatus = "queued" | "merging" | "merged" | "failed";
export type MergeTier = "T1" | "T2" | "T3";

export interface MergeQueueItem {
  queueItemId: string;
  issueId: string;
  candidateBranch: string;
  targetBranch: string;
  laborPath: string;
  status: MergeQueueItemStatus;
  attempts: number;
  janusInvocations: number;
  lastTier: MergeTier | null;
  lastError: string | null;
  enqueuedAt: string;
  updatedAt: string;
}

export interface MergeQueueState {
  schemaVersion: 1;
  items: MergeQueueItem[];
}

export interface EnqueueMergeCandidateInput {
  issueId: string;
  candidateBranch: string;
  targetBranch: string;
  laborPath: string;
  now: string;
}

interface TitanMergeCandidateArtifact {
  labor_path: string;
  candidate_branch: string;
  base_branch: string;
}

const MERGE_QUEUE_FILE = ".aegis/merge-queue.json";

function resolveProjectPath(root: string, relativePath: string) {
  return path.join(path.resolve(root), ...relativePath.split("/"));
}

function mergeQueuePath(root: string) {
  return resolveProjectPath(root, MERGE_QUEUE_FILE);
}

function assertMergeQueueItem(value: unknown): MergeQueueItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Merge queue item must be a JSON object.");
  }

  const item = value as Record<string, unknown>;
  const validStatus = item["status"] === "queued"
    || item["status"] === "merging"
    || item["status"] === "merged"
    || item["status"] === "failed";
  const validTier = item["lastTier"] === null
    || item["lastTier"] === "T1"
    || item["lastTier"] === "T2"
    || item["lastTier"] === "T3";

  if (
    typeof item["queueItemId"] !== "string"
    || typeof item["issueId"] !== "string"
    || typeof item["candidateBranch"] !== "string"
    || typeof item["targetBranch"] !== "string"
    || typeof item["laborPath"] !== "string"
    || !validStatus
    || typeof item["attempts"] !== "number"
    || typeof item["janusInvocations"] !== "number"
    || !validTier
    || !(typeof item["lastError"] === "string" || item["lastError"] === null)
    || typeof item["enqueuedAt"] !== "string"
    || typeof item["updatedAt"] !== "string"
  ) {
    throw new Error("Merge queue item has invalid fields.");
  }

  return {
    queueItemId: item["queueItemId"],
    issueId: item["issueId"],
    candidateBranch: item["candidateBranch"],
    targetBranch: item["targetBranch"],
    laborPath: item["laborPath"],
    status: item["status"] as MergeQueueItemStatus,
    attempts: item["attempts"],
    janusInvocations: item["janusInvocations"],
    lastTier: item["lastTier"] as MergeTier | null,
    lastError: item["lastError"],
    enqueuedAt: item["enqueuedAt"],
    updatedAt: item["updatedAt"],
  };
}

function assertMergeQueueState(value: unknown): MergeQueueState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Merge queue state must be a JSON object.");
  }

  const state = value as Record<string, unknown>;
  if (state["schemaVersion"] !== 1 || !Array.isArray(state["items"])) {
    throw new Error("Merge queue state has invalid schema.");
  }

  return {
    schemaVersion: 1,
    items: state["items"].map((item) => assertMergeQueueItem(item)),
  };
}

export function buildQueueItemId(issueId: string) {
  return `queue-${issueId.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
}

export function emptyMergeQueueState(): MergeQueueState {
  return {
    schemaVersion: 1,
    items: [],
  };
}

export function loadMergeQueueState(root: string): MergeQueueState {
  const filePath = mergeQueuePath(root);

  if (!existsSync(filePath)) {
    return emptyMergeQueueState();
  }

  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (
    typeof parsed === "object"
    && parsed !== null
    && !Array.isArray(parsed)
    && Object.keys(parsed as Record<string, unknown>).length === 0
  ) {
    return emptyMergeQueueState();
  }

  return assertMergeQueueState(parsed);
}

export function saveMergeQueueState(root: string, state: MergeQueueState) {
  writeJsonAtomic(mergeQueuePath(root), state);
}

export function updateMergeQueueItem(
  state: MergeQueueState,
  queueItemId: string,
  updater: (item: MergeQueueItem) => MergeQueueItem,
): MergeQueueState {
  return {
    schemaVersion: state.schemaVersion,
    items: state.items.map((item) =>
      item.queueItemId === queueItemId ? updater(item) : { ...item }),
  };
}

export function findNextQueuedItem(state: MergeQueueState): MergeQueueItem | null {
  return state.items.find((item) => item.status === "queued") ?? null;
}

export function enqueueMergeCandidate(
  state: MergeQueueState,
  input: EnqueueMergeCandidateInput,
): { state: MergeQueueState; item: MergeQueueItem } {
  const existing = state.items.find((item) => item.issueId === input.issueId);
  const queueItemId = existing?.queueItemId ?? buildQueueItemId(input.issueId);
  const queueItem: MergeQueueItem = {
    queueItemId,
    issueId: input.issueId,
    candidateBranch: input.candidateBranch,
    targetBranch: input.targetBranch,
    laborPath: input.laborPath,
    status: "queued",
    attempts: existing?.status === "failed" ? 0 : existing?.attempts ?? 0,
    janusInvocations: existing?.status === "failed" ? 0 : existing?.janusInvocations ?? 0,
    lastTier: existing?.status === "failed" ? null : existing?.lastTier ?? null,
    lastError: null,
    enqueuedAt: existing?.enqueuedAt ?? input.now,
    updatedAt: input.now,
  };

  if (existing) {
    return {
      state: updateMergeQueueItem(state, queueItemId, () => queueItem),
      item: queueItem,
    };
  }

  return {
    state: {
      schemaVersion: state.schemaVersion,
      items: [...state.items.map((item) => ({ ...item })), queueItem],
    },
    item: queueItem,
  };
}

function resolveArtifactPath(root: string, artifactRef: string) {
  return path.join(path.resolve(root), ...artifactRef.split(/[\\/]/));
}

export function readTitanMergeCandidate(root: string, artifactRef: string): TitanMergeCandidateArtifact {
  const raw = JSON.parse(readFileSync(resolveArtifactPath(root, artifactRef), "utf8")) as unknown;

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Titan handoff artifact at ${artifactRef} must be a JSON object.`);
  }

  const artifact = raw as Record<string, unknown>;
  if (
    typeof artifact["labor_path"] !== "string"
    || typeof artifact["candidate_branch"] !== "string"
    || typeof artifact["base_branch"] !== "string"
  ) {
    throw new Error(`Titan handoff artifact at ${artifactRef} is missing merge candidate fields.`);
  }

  return {
    labor_path: artifact["labor_path"],
    candidate_branch: artifact["candidate_branch"],
    base_branch: artifact["base_branch"],
  };
}
