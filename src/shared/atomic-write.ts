import { randomBytes } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export interface RenameWithRetriesOptions {
  rename?: typeof renameSync;
  sleepMs?: (milliseconds: number) => void;
  maxAttempts?: number;
  baseDelayMs?: number;
}

function sleepSync(milliseconds: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : null;
}

function isRetryableRenameError(error: unknown) {
  const code = errorCode(error);
  return code === "EPERM" || code === "EBUSY" || code === "ENOTEMPTY";
}

export function renameWithRetries(
  temporaryPath: string,
  finalPath: string,
  options: RenameWithRetriesOptions = {},
) {
  const rename = options.rename ?? renameSync;
  const sleepMs = options.sleepMs ?? sleepSync;
  const maxAttempts = options.maxAttempts ?? 6;
  const baseDelayMs = options.baseDelayMs ?? 25;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      rename(temporaryPath, finalPath);
      return;
    } catch (error) {
      if (!isRetryableRenameError(error) || attempt === maxAttempts) {
        throw error;
      }
      sleepMs(baseDelayMs * attempt);
    }
  }
}

// Unique per writer so the daemon, direct commands, and Olympus never share a
// temp file for the same target.
export function buildTemporaryPath(targetPath: string) {
  return `${targetPath}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
}

function removeQuietly(filePath: string) {
  try {
    unlinkSync(filePath);
  } catch {
    // Best effort cleanup only.
  }
}

export function formatJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Atomically replaces `targetPath` with `contents` via temp file + rename. */
export function writeTextAtomic(targetPath: string, contents: string) {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = buildTemporaryPath(targetPath);

  try {
    writeFileSync(temporaryPath, contents, "utf8");
    renameWithRetries(temporaryPath, targetPath);
  } catch (error) {
    removeQuietly(temporaryPath);
    throw error;
  }
}

/** Atomically replaces `targetPath` with pretty-printed JSON. */
export function writeJsonAtomic(targetPath: string, value: unknown) {
  writeTextAtomic(targetPath, formatJson(value));
}

function withCollisionSuffix(targetPath: string, attempt: number) {
  if (attempt === 1) {
    return targetPath;
  }

  const extension = path.extname(targetPath);
  return `${targetPath.slice(0, targetPath.length - extension.length)}~${attempt}${extension}`;
}

/**
 * Atomically creates a new JSON file without ever overwriting an existing one.
 * When `targetPath` is taken, a `~N` suffix is added before the extension.
 * Returns the path that was written.
 */
export function createJsonExclusive(targetPath: string, value: unknown, maxAttempts = 1_000) {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = buildTemporaryPath(targetPath);
  writeFileSync(temporaryPath, formatJson(value), "utf8");

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const candidate = withCollisionSuffix(targetPath, attempt);
      try {
        // link() fails with EEXIST instead of replacing, which makes the
        // create step atomic across concurrent writers.
        linkSync(temporaryPath, candidate);
        return candidate;
      } catch (error) {
        if (errorCode(error) === "EEXIST") {
          continue;
        }
        // Filesystems without hard links: fall back to check-then-rename.
        if (existsSync(candidate)) {
          continue;
        }
        renameWithRetries(temporaryPath, candidate);
        return candidate;
      }
    }
  } finally {
    removeQuietly(temporaryPath);
  }

  throw new Error(`Unable to create unique file for ${targetPath}.`);
}
