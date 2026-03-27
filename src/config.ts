// src/config.ts
// Config loading and validation for Aegis.
// This is the ONLY module that reads .aegis/config.json.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AegisConfig } from "./types.js";

export function getDefaultConfig(): AegisConfig {
  return {
    version: 2,
    runtime: "pi",
    auth: {
      anthropic: null,
      openai: null,
      google: null,
    },
    models: {
      oracle: "claude-haiku-4-5",
      titan: "claude-sonnet-4-6",
      sentinel: "claude-sonnet-4-6",
      metis: "claude-haiku-4-5",
      prometheus: "claude-sonnet-4-6",
    },
    concurrency: {
      max_agents: 3,
      max_oracles: 2,
      max_titans: 3,
      max_sentinels: 1,
    },
    budgets: {
      oracle_turns: 10,
      oracle_tokens: 80000,
      titan_turns: 20,
      titan_tokens: 300000,
      sentinel_turns: 8,
      sentinel_tokens: 100000,
    },
    timing: {
      poll_interval_seconds: 5,
      stuck_warning_seconds: 90,
      stuck_kill_seconds: 150,
    },
    mnemosyne: {
      max_records: 500,
      context_budget_tokens: 1000,
    },
    labors: {
      base_path: ".aegis/labors",
    },
    olympus: {
      port: 3847,
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

function requirePositiveInteger(
  parent: Record<string, unknown>,
  path: string
): number {
  const val = requirePositiveNumber(parent, path);
  if (!Number.isInteger(val)) {
    throw new Error(
      `Config: '${path}' must be a positive integer, got ${val}`
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

// --- Migration ---

function migrateV1toV2(r: Record<string, unknown>): Record<string, unknown> {
  // runtime: { adapter: "pi" }  →  runtime: "pi"
  const rt = r["runtime"];
  if (rt !== null && typeof rt === "object" && !Array.isArray(rt)) {
    r = { ...r, runtime: (rt as Record<string, unknown>)["adapter"] ?? "pi" };
  }
  // Coerce oracle budget defaults to v2 values
  const budgets = r["budgets"];
  if (budgets !== null && typeof budgets === "object" && !Array.isArray(budgets)) {
    r = {
      ...r,
      budgets: {
        ...(budgets as Record<string, unknown>),
        oracle_turns: 10,
        oracle_tokens: 80000,
      },
    };
  }
  return { ...r, version: 2 };
}

// --- Public API ---

export function validateConfig(raw: unknown): AegisConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Config must be a JSON object");
  }
  let r = raw as Record<string, unknown>;

  if (r["version"] === 1) {
    r = migrateV1toV2(r);
  }
  if (r["version"] !== 2) {
    throw new Error(
      `Config: 'version' must be 2, got ${JSON.stringify(r["version"])}`
    );
  }

  const runtimeStr = r["runtime"] === undefined ? "pi" : r["runtime"];
  if (runtimeStr !== "pi") {
    throw new Error(
      `Config: 'runtime' must be "pi", got ${JSON.stringify(runtimeStr)}`
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
    version: 2,

    runtime: "pi",

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
      max_agents: requirePositiveInteger(concurrency, "concurrency.max_agents"),
      max_oracles: requirePositiveInteger(concurrency, "concurrency.max_oracles"),
      max_titans: requirePositiveInteger(concurrency, "concurrency.max_titans"),
      max_sentinels: requirePositiveInteger(
        concurrency,
        "concurrency.max_sentinels"
      ),
    },

    budgets: {
      oracle_turns: requirePositiveInteger(budgets, "budgets.oracle_turns"),
      oracle_tokens: requirePositiveInteger(budgets, "budgets.oracle_tokens"),
      titan_turns: requirePositiveInteger(budgets, "budgets.titan_turns"),
      titan_tokens: requirePositiveInteger(budgets, "budgets.titan_tokens"),
      sentinel_turns: requirePositiveInteger(budgets, "budgets.sentinel_turns"),
      sentinel_tokens: requirePositiveInteger(budgets, "budgets.sentinel_tokens"),
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
      max_records: requirePositiveInteger(mnemosyne, "mnemosyne.max_records"),
      context_budget_tokens: requirePositiveInteger(
        mnemosyne,
        "mnemosyne.context_budget_tokens"
      ),
    },

    labors: {
      base_path: requireString(labors, "labors.base_path"),
    },

    olympus: {
      port: requirePositiveInteger(olympus, "olympus.port"),
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
