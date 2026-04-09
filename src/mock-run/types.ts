export type MockRunIssueType = "epic" | "task";
export type MockRunPriority = 0 | 1 | 2 | 3 | 4;
export type MockRunQueueRole = "coordination" | "executable";

export interface MockRunIssueDefinition {
  key: string;
  title: string;
  description: string;
  issueType: MockRunIssueType;
  priority: MockRunPriority;
  queueRole: MockRunQueueRole;
  parentKey: string | null;
  blocks: string[];
  labels: string[];
}

export interface MockRunManifest {
  repoName: string;
  beadsPrefix: string;
  baselineFiles: Record<string, string>;
  issues: MockRunIssueDefinition[];
  expectedInitialReadyKeys: string[];
}
