import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type JsonRecord = Record<string, unknown>;

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Reads a JSON file, returning `null` when it is missing or malformed. */
export function readJsonFileOrNull(filePath: string): unknown {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** Reads a project-relative artifact ref as a JSON object, or `null`. */
export function readArtifactRecord(root: string, artifactRef: string | null | undefined): JsonRecord | null {
  if (!artifactRef) {
    return null;
  }

  const artifactPath = path.isAbsolute(artifactRef)
    ? artifactRef
    : path.join(path.resolve(root), ...artifactRef.split(/[\\/]/));
  const parsed = readJsonFileOrNull(artifactPath);
  return isJsonRecord(parsed) ? parsed : null;
}

function stripMarkdownFence(text: string) {
  const fenced = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/.exec(text);
  return fenced ? fenced[1]!.trim() : text;
}

function findBalancedObjects(text: string) {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = depth > 0;
    } else if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        objects.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
}

/**
 * Parses model output that should be a single JSON object.
 *
 * JSON-mode adapters (Codex, Claude Code) occasionally wrap the artifact in a
 * markdown fence or add a sentence of prose. Strict JSON is tried first; then a
 * fenced block; then the last balanced top-level object in the text. Parsing
 * still fails loudly when no object can be recovered, and the caste parsers
 * keep enforcing the artifact schema.
 */
export function parseJsonObjectText(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch (strictError) {
    const unfenced = stripMarkdownFence(trimmed);
    if (unfenced !== trimmed) {
      try {
        return JSON.parse(unfenced) as unknown;
      } catch {
        // Fall through to balanced-object recovery.
      }
    }

    const candidates = findBalancedObjects(unfenced);
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(candidates[index]!) as unknown;
      } catch {
        // Try the previous candidate.
      }
    }

    throw strictError;
  }
}
