// src/config.ts
// Config loading and validation for Aegis.
// This is the ONLY module that reads .aegis/config.json.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AegisConfig } from "./types.js";

export function getDefaultConfig(): AegisConfig {
  return {
    version: 1,
    auth: {
      anthropic: null,
      openai: null,
      google: null,
    },
    models: {
      oracle: "claude-haiku-4-5",
      titan: "claude-sonnet-4-5",
      sentinel: "claude-opus-4-5",
      metis: "claude-haiku-4-5",
      prometheus: "claude-opus-4-5",
    },
    concurrency: {
      max_agents: 4,
      max_oracles: 2,
      max_titans: 2,
      max_sentinels: 1,
    },
    budgets: {
      oracle_turns: 20,
      oracle_tokens: 50000,
      titan_turns: 100,
      titan_tokens: 200000,
      sentinel_turns: 30,
      sentinel_tokens: 80000,
    },
    timing: {
      poll_interval_seconds: 5,
      stuck_warning_seconds: 120,
      stuck_kill_seconds: 300,
    },
    mnemosyne: {
      max_records: 500,
      context_budget_tokens: 4000,
    },
    labors: {
      base_path: ".aegis/labors",
    },
    olympus: {
      port: 3737,
      open_browser: true,
    },
  };
}

// --- Validation helpers ---

function requireObject(
  parent: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const val = parent[key];
  if (val === null || val === undefined || typeof val !== "object" || Array.isArray(val)) {
    throw new Error(`Config: '${key}' must be an object`);
  }
  return val as Record<string, unknown>;
}

function requireString(parent: Record<string, unknown>, path: string): string {
  const val = parent[path.split(".").pop()!];
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(
      `Config: '${path}' must be a non-empty string, got ${JSON.stringify(val)}`
    );
  }
  return val;
}

function requireStringOrNull(
  parent: Record<string, unknown>,
  key: string
): string | null {
  const val = parent[key];
  if (val === null || val === undefined) return null;
  if (typeof val !== "string") {
    throw new Error(`Config: '${key}' must be a string or null`);
  }
  return val;
}

function requirePositiveNumber(
  parent: Record<string, unknown>,
  path: string
): number {
  const key = path.split(".").pop()!;
  const val = parent[key];
  if (typeof val !== "number" || !isFinite(val) || val <= 0) {
    throw new Error(
      `Config: '${path}' must be a positive number (> 0), got ${JSON.stringify(val)}`
    );
  }
  return val;
}

function requireBoolean(
  parent: Record<string, unknown>,
  path: string
): boolean {
  const key = path.split(".").pop()!;
  const val = parent[key];
  if (typeof val !== "boolean") {
    throw new Error(
      `Config: '${path}' must be a boolean, got ${JSON.stringify(val)}`
    );
  }
  return val;
}

// --- Public API ---

export function validateConfig(raw: unknown): AegisConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Config must be a JSON object");
  }
  const r = raw as Record<string, unknown>;

  if (r["version"] !== 1) {
    throw new Error(
      `Config: 'version' must be 1, got ${JSON.stringify(r["version"])}`
    );
  }

  const auth = requireObject(r, "auth");
  const models = requireObject(r, "models");
  const concurrency = requireObject(r, "concurrency");
  const budgets = requireObject(r, "budgets");
  const timing = requireObject(r, "timing");
  const mnemosyne = requireObject(r, "mnemosyne");
  const labors = requireObject(r, "labors");
  const olympus = requireObject(r, "olympus");

  return {
    version: 1,

    auth: {
      anthropic: requireStringOrNull(auth, "anthropic"),
      openai: requireStringOrNull(auth, "openai"),
      google: requireStringOrNull(auth, "google"),
    },

    models: {
      oracle: requireString(models, "models.oracle"),
      titan: requireString(models, "models.titan"),
      sentinel: requireString(models, "models.sentinel"),
      metis: requireString(models, "models.metis"),
      prometheus: requireString(models, "models.prometheus"),
    },

    concurrency: {
      max_agents: requirePositiveNumber(concurrency, "concurrency.max_agents"),
      max_oracles: requirePositiveNumber(concurrency, "concurrency.max_oracles"),
      max_titans: requirePositiveNumber(concurrency, "concurrency.max_titans"),
      max_sentinels: requirePositiveNumber(
        concurrency,
        "concurrency.max_sentinels"
      ),
    },

    budgets: {
      oracle_turns: requirePositiveNumber(budgets, "budgets.oracle_turns"),
      oracle_tokens: requirePositiveNumber(budgets, "budgets.oracle_tokens"),
      titan_turns: requirePositiveNumber(budgets, "budgets.titan_turns"),
      titan_tokens: requirePositiveNumber(budgets, "budgets.titan_tokens"),
      sentinel_turns: requirePositiveNumber(budgets, "budgets.sentinel_turns"),
      sentinel_tokens: requirePositiveNumber(budgets, "budgets.sentinel_tokens"),
    },

    timing: {
      poll_interval_seconds: requirePositiveNumber(
        timing,
        "timing.poll_interval_seconds"
      ),
      stuck_warning_seconds: requirePositiveNumber(
        timing,
        "timing.stuck_warning_seconds"
      ),
      stuck_kill_seconds: requirePositiveNumber(
        timing,
        "timing.stuck_kill_seconds"
      ),
    },

    mnemosyne: {
      max_records: requirePositiveNumber(mnemosyne, "mnemosyne.max_records"),
      context_budget_tokens: requirePositiveNumber(
        mnemosyne,
        "mnemosyne.context_budget_tokens"
      ),
    },

    labors: {
      base_path: requireString(labors, "labors.base_path"),
    },

    olympus: {
      port: requirePositiveNumber(olympus, "olympus.port"),
      open_browser: requireBoolean(olympus, "olympus.open_browser"),
    },
  };
}

export function loadConfig(projectRoot?: string): AegisConfig {
  const root = projectRoot ?? process.cwd();
  const configPath = join(root, ".aegis", "config.json");

  let content: string;
  try {
    content = readFileSync(configPath, "utf8");
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ENOENT") {
      throw new Error(
        `Config file not found at ${configPath}. Run \`aegis init\` to create it.`
      );
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in ${configPath}: ${msg}`);
  }

  return validateConfig(parsed);
}
