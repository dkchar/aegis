const ISSUE_ID_PATTERN = /^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/;

export function isSafeIssueId(value: string): boolean {
  return ISSUE_ID_PATTERN.test(value);
}

export function assertSafeIssueId(value: string): string {
  if (!isSafeIssueId(value)) {
    throw new Error(`Invalid issue id: ${value}`);
  }

  return value;
}
