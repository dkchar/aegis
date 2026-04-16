export interface TrackerReadyIssue {
  id: string;
  title: string;
}

import type { AegisIssue } from "./issue-model.js";

export interface TrackerClient {
  listReadyIssues(root?: string): Promise<TrackerReadyIssue[]>;
  getIssue?(id: string, root?: string): Promise<AegisIssue>;
  closeIssue?(id: string, root?: string): Promise<void>;
}
