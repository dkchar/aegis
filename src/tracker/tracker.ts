export interface TrackerReadyIssue {
  id: string;
  title: string;
}

export interface TrackerClient {
  listReadyIssues(root?: string): Promise<TrackerReadyIssue[]>;
}
