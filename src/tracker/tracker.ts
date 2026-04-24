export interface TrackerReadyIssue {
  id: string;
  title: string;
}

import type { AegisIssue } from "./issue-model.js";

export interface TrackerCreateIssueInput {
  title: string;
  description: string;
  dependencies?: string[];
}

export interface TrackerLinkInput {
  blockingIssueId: string;
  blockedIssueId: string;
}

export interface TrackerClient {
  listReadyIssues(root?: string): Promise<TrackerReadyIssue[]>;
  getIssue?(id: string, root?: string): Promise<AegisIssue>;
  closeIssue?(id: string, root?: string): Promise<void>;
  createIssue?(input: TrackerCreateIssueInput, root?: string): Promise<string>;
  linkBlockingIssue?(input: TrackerLinkInput, root?: string): Promise<void>;
}
