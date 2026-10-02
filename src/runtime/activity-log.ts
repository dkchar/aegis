const DEFAULT_MAX_LINES = 400;

/** Collapses whitespace and truncates so one activity entry stays one line. */
export function compactActivityText(text: string, maxChars = 240) {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > maxChars ? `${single.slice(0, maxChars - 3)}...` : single;
}

/**
 * Operator-facing adapter activity (`[tool] Bash npm test`). Lines are kept in
 * a bounded buffer for the session transcript and forwarded as they happen so
 * the session stream shows live progress.
 */
export class ActivityLog {
  readonly lines: string[] = [];

  constructor(
    private readonly onLine?: (line: string) => void,
    private readonly maxLines = DEFAULT_MAX_LINES,
  ) {}

  push(line: string) {
    this.lines.push(line);
    if (this.lines.length > this.maxLines) {
      this.lines.splice(0, this.lines.length - this.maxLines);
    }
    this.onLine?.(line);
  }
}
