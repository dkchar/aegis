import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MAX_LOG_LINES = 180;
const TAIL_BYTES_PER_LINE = 512;
const JSON_CACHE_LIMIT = 4_000;

// Olympus re-reads the same .aegis files every stream tick; parse each file
// only when its size or mtime changes.
const jsonCache = new Map();

function statOrNull(filePath) {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}

export function readJson(filePath, fallback = null) {
  const stats = statOrNull(filePath);
  if (!stats) return fallback;

  const cached = jsonCache.get(filePath);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.value ?? fallback;
  }

  let value = null;
  try {
    value = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    value = null;
  }
  if (jsonCache.size >= JSON_CACHE_LIMIT) jsonCache.clear();
  jsonCache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, value });
  return value ?? fallback;
}

export function readText(filePath, maxBytes = Infinity) {
  const stats = statOrNull(filePath);
  if (!stats) return "";
  if (stats.size <= maxBytes) return readFileSync(filePath, "utf8");

  const buffer = Buffer.alloc(maxBytes);
  const fd = openSync(filePath, "r");
  try {
    readSync(fd, buffer, 0, maxBytes, stats.size - maxBytes);
  } finally {
    closeSync(fd);
  }
  return buffer.toString("utf8");
}

export function writeJsonAtomic(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

/** Last `maxLines` non-empty lines, reading only the end of large logs. */
export function tailLines(filePath, maxLines = MAX_LOG_LINES) {
  if (!existsSync(filePath)) return [];
  return readText(filePath, maxLines * TAIL_BYTES_PER_LINE)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-maxLines);
}

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

const MAX_BODY_BYTES = 1_000_000;

export function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export async function readJsonBody(req) {
  const body = await readRequestBody(req);
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}
