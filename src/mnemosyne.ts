// src/mnemosyne.ts
// Mnemosyne — learnings store read/write interface.
// Agents accumulate project knowledge as JSONL in .aegis/mnemosyne.jsonl.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { MnemosyneRecord } from "./types.js";

const MNEMOSYNE_PATH = ".aegis/mnemosyne.jsonl";

// Estimate tokens as ~4 chars per token
const CHARS_PER_TOKEN = 4;

function mnemosynePath(projectRoot: string): string {
  return join(projectRoot, MNEMOSYNE_PATH);
}

/**
 * Load all records from .aegis/mnemosyne.jsonl.
 * Returns empty array if file doesn't exist.
 * Skips malformed lines with a console.warn (does not throw).
 */
export function load(projectRoot: string = process.cwd()): MnemosyneRecord[] {
  const filePath = mnemosynePath(projectRoot);
  if (!existsSync(filePath)) {
    return [];
  }

  const content = readFileSync(filePath, "utf8");
  const records: MnemosyneRecord[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        records.push(parsed as MnemosyneRecord);
      } else {
        console.warn(`mnemosyne: skipping malformed line (not an object): ${trimmed}`);
      }
    } catch {
      console.warn(`mnemosyne: skipping malformed JSON line: ${trimmed}`);
    }
  }

  return records;
}

/**
 * Append a new record to .aegis/mnemosyne.jsonl.
 * Generates id (l-<random>) and ts (Date.now()).
 * Creates the file (and parent dir) if it doesn't exist.
 * Returns the completed record.
 */
export function append(
  record: Omit<MnemosyneRecord, "id" | "ts">,
  projectRoot: string = process.cwd()
): MnemosyneRecord {
  const filePath = mnemosynePath(projectRoot);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const completed: MnemosyneRecord = {
    ...record,
    id: `l-${randomBytes(4).toString("hex")}`,
    ts: Date.now(),
  };

  appendFileSync(filePath, JSON.stringify(completed) + "\n", "utf8");
  return completed;
}

/**
 * Filter records by domain keyword match, sort by ts descending,
 * and truncate to fit within the token budget.
 *
 * If no records match the domain, falls back to the most recent records
 * that fit the budget.
 */
export function filter(
  records: MnemosyneRecord[],
  domain: string,
  tokenBudget: number
): MnemosyneRecord[] {
  const charBudget = tokenBudget * CHARS_PER_TOKEN;

  const domainLower = domain.toLowerCase();
  const matching = records.filter(
    (r) => r.domain.toLowerCase().includes(domainLower)
  );

  // Fall back to all records if no domain match
  const candidates = matching.length > 0 ? matching : records;

  // Sort by timestamp descending (newest first)
  const sorted = [...candidates].sort((a, b) => b.ts - a.ts);

  // Truncate to fit token budget
  const result: MnemosyneRecord[] = [];
  let usedChars = 0;
  for (const record of sorted) {
    const recordChars = JSON.stringify(record).length;
    if (usedChars + recordChars > charBudget) break;
    result.push(record);
    usedChars += recordChars;
  }

  return result;
}

/**
 * Post-process records that are missing metadata fields.
 * Fills in id, source, issue, ts for records that lack them.
 * Does not overwrite fields that already exist.
 * Returns the completed records (does NOT persist — caller handles that).
 */
export function postProcess(
  records: MnemosyneRecord[],
  agentId: string,
  issueId: string
): MnemosyneRecord[] {
  return records.map((record) => {
    const completed: MnemosyneRecord = { ...record };

    if (!completed.id) {
      completed.id = `l-${randomBytes(4).toString("hex")}`;
    }
    if (!completed.source) {
      completed.source = agentId;
    }
    if (completed.issue === undefined || completed.issue === null) {
      completed.issue = issueId;
    }
    if (!completed.ts) {
      completed.ts = Date.now();
    }

    return completed;
  });
}
