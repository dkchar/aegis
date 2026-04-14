export interface RuntimeLaunchInput {
  root: string;
  issueId: string;
  title: string;
  caste: "oracle";
  stage: "scouting";
}

export interface RuntimeLaunchResult {
  sessionId: string;
  startedAt: string;
}

export interface RuntimeSessionSnapshot {
  sessionId: string;
  status: "running" | "succeeded" | "failed";
  finishedAt?: string;
  error?: string;
}

export interface AgentRuntime {
  launch(input: RuntimeLaunchInput): Promise<RuntimeLaunchResult>;
  readSession(root: string, sessionId: string): Promise<RuntimeSessionSnapshot | null>;
  terminate(
    root: string,
    sessionId: string,
    reason: string,
  ): Promise<RuntimeSessionSnapshot | null>;
}
