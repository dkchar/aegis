import path from "node:path";
import { readFileSync } from "node:fs";

import { DEFAULT_AEGIS_CONFIG } from "./defaults.js";
import { AEGIS_DIRECTORY } from "./schema.js";
import type { AegisConfig } from "./schema.js";
import { AUTH_KEYS } from "./schema.js";
import { BUDGET_KEYS } from "./schema.js";
import { BUDGET_LIMIT_KEYS } from "./schema.js";
import { CONCURRENCY_KEYS } from "./schema.js";
import { CONFIG_TOP_LEVEL_KEYS } from "./schema.js";
import { ECONOMICS_KEYS } from "./schema.js";
import { EVAL_KEYS } from "./schema.js";
import { JANUS_KEYS } from "./schema.js";
import { LABOR_KEYS } from "./schema.js";
import { MNEMOSYNE_KEYS } from "./schema.js";
import { MODEL_KEYS } from "./schema.js";
import { OLYMPUS_KEYS } from "./schema.js";
import { THRESHOLD_KEYS } from "./schema.js";

export { AEGIS_DIRECTORY } from "./schema.js";

export const DEFAULT_CONFIG_FILE = "config.json";
export const AEGIS_CONFIG_PATH = `${AEGIS_DIRECTORY}/${DEFAULT_CONFIG_FILE}`;

export function resolveProjectRelativePath(
  root: string,
  relativePath: string,
) {
  return path.join(path.resolve(root), ...relativePath.split("/"));
}

export function resolveConfigPath(root = process.cwd()) {
  return resolveProjectRelativePath(root, AEGIS_CONFIG_PATH);
}

type PartialConfig = Partial<AegisConfig>;
type ConfigRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, fieldPath: string): asserts value is ConfigRecord {
  if (!isRecord(value)) {
    throw new Error(`Expected "${fieldPath}" to be an object`);
  }
}

function assertString(value: unknown, fieldPath: string) {
  if (typeof value !== "string") {
    throw new Error(`Expected "${fieldPath}" to be a string`);
  }
}

function assertBoolean(value: unknown, fieldPath: string) {
  if (typeof value !== "boolean") {
    throw new Error(`Expected "${fieldPath}" to be a boolean`);
  }
}

function assertNumber(value: unknown, fieldPath: string): asserts value is number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Expected "${fieldPath}" to be a number`);
  }
}

function assertNumberAtLeast(value: unknown, fieldPath: string, minimum: number) {
  assertNumber(value, fieldPath);

  if (value < minimum) {
    throw new Error(`Expected "${fieldPath}" to be at least ${minimum}`);
  }
}

function assertNumberInRange(
  value: unknown,
  fieldPath: string,
  minimum: number,
  maximum: number,
) {
  assertNumber(value, fieldPath);

  if (value < minimum || value > maximum) {
    throw new Error(
      `Expected "${fieldPath}" to be between ${minimum} and ${maximum}`,
    );
  }
}

function assertNullableString(value: unknown, fieldPath: string) {
  if (value !== null) {
    assertString(value, fieldPath);
  }
}

function assertNullableNumber(value: unknown, fieldPath: string) {
  if (value !== null) {
    assertNumber(value, fieldPath);
  }
}

function assertEnumValue(
  value: unknown,
  fieldPath: string,
  allowedValues: readonly string[],
) {
  assertString(value, fieldPath);
  const stringValue = value as string;

  if (!allowedValues.includes(stringValue)) {
    throw new Error(
      `Expected "${fieldPath}" to be one of: ${allowedValues.join(", ")}`,
    );
  }
}

function validateKnownKeys(
  value: ConfigRecord,
  fieldPath: string,
  allowedKeys: readonly string[],
) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      const prefix = fieldPath === "config" ? "config key" : `${fieldPath} key`;
      throw new Error(`Unknown ${prefix} "${key}"`);
    }
  }
}

function validatePartialConfig(config: unknown): asserts config is PartialConfig {
  assertRecord(config, "config");
  validateKnownKeys(config, "config", CONFIG_TOP_LEVEL_KEYS);

  if ("runtime" in config) {
    assertString(config.runtime, "runtime");
  }

  if ("auth" in config) {
    assertRecord(config.auth, "auth");
    validateKnownKeys(config.auth, "auth", AUTH_KEYS);
    if ("provider" in config.auth) {
      assertString(config.auth.provider, "auth.provider");
    }
    if ("mode" in config.auth) {
      assertEnumValue(config.auth.mode, "auth.mode", [
        "api_key",
        "subscription",
        "workspace_subscription",
      ]);
    }
    if ("plan" in config.auth) {
      assertNullableString(config.auth.plan, "auth.plan");
    }
  }

  if ("models" in config) {
    assertRecord(config.models, "models");
    validateKnownKeys(config.models, "models", MODEL_KEYS);
    for (const key of Object.keys(config.models)) {
      assertString(config.models[key], `models.${key}`);
    }
  }

  if ("concurrency" in config) {
    assertRecord(config.concurrency, "concurrency");
    validateKnownKeys(config.concurrency, "concurrency", CONCURRENCY_KEYS);
    for (const key of Object.keys(config.concurrency)) {
      assertNumberAtLeast(config.concurrency[key], `concurrency.${key}`, 1);
    }
  }

  if ("budgets" in config) {
    assertRecord(config.budgets, "budgets");
    validateKnownKeys(config.budgets, "budgets", BUDGET_KEYS);
    for (const key of Object.keys(config.budgets)) {
      assertRecord(config.budgets[key], `budgets.${key}`);
      validateKnownKeys(config.budgets[key], `budgets.${key}`, BUDGET_LIMIT_KEYS);
      if ("turns" in config.budgets[key]) {
        assertNumberAtLeast(config.budgets[key].turns, `budgets.${key}.turns`, 1);
      }
      if ("tokens" in config.budgets[key]) {
        assertNumberAtLeast(config.budgets[key].tokens, `budgets.${key}.tokens`, 1);
      }
    }
  }

  if ("thresholds" in config) {
    assertRecord(config.thresholds, "thresholds");
    validateKnownKeys(config.thresholds, "thresholds", THRESHOLD_KEYS);

    for (const key of [
      "poll_interval_seconds",
      "stuck_warning_seconds",
      "stuck_kill_seconds",
      "scope_overlap_threshold",
      "janus_retry_threshold",
    ] as const) {
      if (key in config.thresholds) {
        assertNumberAtLeast(config.thresholds[key], `thresholds.${key}`, 0);
      }
    }

    if ("allow_complex_auto_dispatch" in config.thresholds) {
      assertBoolean(
        config.thresholds.allow_complex_auto_dispatch,
        "thresholds.allow_complex_auto_dispatch",
      );
    }
  }

  if ("economics" in config) {
    assertRecord(config.economics, "economics");
    validateKnownKeys(config.economics, "economics", ECONOMICS_KEYS);
    if ("metering_fallback" in config.economics) {
      assertEnumValue(config.economics.metering_fallback, "economics.metering_fallback", [
        "stats_only",
        "exact_usd",
        "quota",
        "credits",
        "unknown",
      ]);
    }
    for (const key of [
      "per_issue_cost_warning_usd",
      "daily_cost_warning_usd",
      "daily_hard_stop_usd",
      "quota_warning_floor_pct",
      "quota_hard_stop_floor_pct",
      "credit_warning_floor",
      "credit_hard_stop_floor",
    ] as const) {
      if (key in config.economics) {
        assertNullableNumber(config.economics[key], `economics.${key}`);
        if (config.economics[key] !== null) {
          assertNumberAtLeast(config.economics[key], `economics.${key}`, 0);
        }
      }
    }
    for (const key of [
      "quota_warning_floor_pct",
      "quota_hard_stop_floor_pct",
    ] as const) {
      if (key in config.economics && config.economics[key] !== null) {
        assertNumberInRange(config.economics[key], `economics.${key}`, 0, 100);
      }
    }
    if ("allow_exact_cost_estimation" in config.economics) {
      assertBoolean(
        config.economics.allow_exact_cost_estimation,
        "economics.allow_exact_cost_estimation",
      );
    }
  }

  if ("janus" in config) {
    assertRecord(config.janus, "janus");
    validateKnownKeys(config.janus, "janus", JANUS_KEYS);
    if ("enabled" in config.janus) {
      assertBoolean(config.janus.enabled, "janus.enabled");
    }
    if ("max_invocations_per_issue" in config.janus) {
      assertNumberAtLeast(
        config.janus.max_invocations_per_issue,
        "janus.max_invocations_per_issue",
        1,
      );
    }
  }

  if ("mnemosyne" in config) {
    assertRecord(config.mnemosyne, "mnemosyne");
    validateKnownKeys(config.mnemosyne, "mnemosyne", MNEMOSYNE_KEYS);
    if ("max_records" in config.mnemosyne) {
      assertNumberAtLeast(config.mnemosyne.max_records, "mnemosyne.max_records", 1);
    }
    if ("prompt_token_budget" in config.mnemosyne) {
      assertNumberAtLeast(
        config.mnemosyne.prompt_token_budget,
        "mnemosyne.prompt_token_budget",
        1,
      );
    }
  }

  if ("labor" in config) {
    assertRecord(config.labor, "labor");
    validateKnownKeys(config.labor, "labor", LABOR_KEYS);
    if ("base_path" in config.labor) {
      assertString(config.labor.base_path, "labor.base_path");
    }
  }

  if ("olympus" in config) {
    assertRecord(config.olympus, "olympus");
    validateKnownKeys(config.olympus, "olympus", OLYMPUS_KEYS);
    if ("port" in config.olympus) {
      assertNumberInRange(config.olympus.port, "olympus.port", 1, 65535);
    }
    if ("open_browser" in config.olympus) {
      assertBoolean(config.olympus.open_browser, "olympus.open_browser");
    }
  }

  if ("evals" in config) {
    assertRecord(config.evals, "evals");
    validateKnownKeys(config.evals, "evals", EVAL_KEYS);
    if ("enabled" in config.evals) {
      assertBoolean(config.evals.enabled, "evals.enabled");
    }
    if ("results_path" in config.evals) {
      assertString(config.evals.results_path, "evals.results_path");
    }
    if ("benchmark_suite" in config.evals) {
      assertString(config.evals.benchmark_suite, "evals.benchmark_suite");
    }
    if ("minimum_pass_rate" in config.evals) {
      assertNumberInRange(
        config.evals.minimum_pass_rate,
        "evals.minimum_pass_rate",
        0,
        1,
      );
    }
    if ("max_human_interventions_per_10_issues" in config.evals) {
      assertNumberAtLeast(
        config.evals.max_human_interventions_per_10_issues,
        "evals.max_human_interventions_per_10_issues",
        0,
      );
    }
  }
}

function mergeConfig(config: PartialConfig): AegisConfig {
  return {
    ...DEFAULT_AEGIS_CONFIG,
    ...config,
    auth: {
      ...DEFAULT_AEGIS_CONFIG.auth,
      ...config.auth,
    },
    models: {
      ...DEFAULT_AEGIS_CONFIG.models,
      ...config.models,
    },
    concurrency: {
      ...DEFAULT_AEGIS_CONFIG.concurrency,
      ...config.concurrency,
    },
    budgets: {
      ...DEFAULT_AEGIS_CONFIG.budgets,
      ...config.budgets,
      oracle: {
        ...DEFAULT_AEGIS_CONFIG.budgets.oracle,
        ...config.budgets?.oracle,
      },
      titan: {
        ...DEFAULT_AEGIS_CONFIG.budgets.titan,
        ...config.budgets?.titan,
      },
      sentinel: {
        ...DEFAULT_AEGIS_CONFIG.budgets.sentinel,
        ...config.budgets?.sentinel,
      },
      janus: {
        ...DEFAULT_AEGIS_CONFIG.budgets.janus,
        ...config.budgets?.janus,
      },
    },
    thresholds: {
      ...DEFAULT_AEGIS_CONFIG.thresholds,
      ...config.thresholds,
    },
    economics: {
      ...DEFAULT_AEGIS_CONFIG.economics,
      ...config.economics,
    },
    janus: {
      ...DEFAULT_AEGIS_CONFIG.janus,
      ...config.janus,
    },
    mnemosyne: {
      ...DEFAULT_AEGIS_CONFIG.mnemosyne,
      ...config.mnemosyne,
    },
    labor: {
      ...DEFAULT_AEGIS_CONFIG.labor,
      ...config.labor,
    },
    olympus: {
      ...DEFAULT_AEGIS_CONFIG.olympus,
      ...config.olympus,
    },
    evals: {
      ...DEFAULT_AEGIS_CONFIG.evals,
      ...config.evals,
    },
  };
}

export function loadConfig(root = process.cwd()): AegisConfig {
  const configPath = resolveConfigPath(root);

  let rawConfig: string;

  try {
    rawConfig = readFileSync(configPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`Missing Aegis config at ${configPath}`);
    }

    throw error;
  }

  let parsedConfig: unknown;

  try {
    parsedConfig = JSON.parse(rawConfig) as unknown;
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Aegis config JSON at ${configPath}: ${details}`);
  }

  validatePartialConfig(parsedConfig);
  return mergeConfig(parsedConfig);
}
