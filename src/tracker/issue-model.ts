export type WorkIssueClass =
  | "primary"
  | "sub"
  | "fix"
  | "conflict"
  | "escalation"
  | "clarification";

export type IssueStatus = "open" | "in_progress" | "closed" | "blocked";

export interface AegisIssue {
  id: string;
  title: string;
  description: string | null;
  issueClass: WorkIssueClass;
  status: IssueStatus;
  priority: number;
  blockers: string[];
  parentId: string | null;
  childIds: string[];
  labels: string[];
}
