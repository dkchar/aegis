import path from "node:path";
import { readFileSync } from "node:fs";

import { DEFAULT_AEGIS_CONFIG } from "./defaults.js";
import { AEGIS_DIRECTORY } from "./schema.js";
import type { AegisConfig } from "./schema.js";
import { CONFIG_TOP_LEVEL_KEYS } from "./schema.js";

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

function assertNumber(value: unknown, fieldPath: string) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Expected "${fieldPath}" to be a number`);
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
    validateKnownKeys(config.auth, "auth", ["provider", "mode", "plan"]);
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
    validateKnownKeys(config.models, "models", [
      "oracle",
      "titan",
      "sentinel",
      "janus",
      "metis",
      "prometheus",
    ]);
    for (const key of Object.keys(config.models)) {
      assertString(config.models[key], `models.${key}`);
    }
  }

  if ("concurrency" in config) {
    assertRecord(config.concurrency, "concurrency");
    validateKnownKeys(config.concurrency, "concurrency", [
      "max_agents",
      "max_oracles",
      "max_titans",
      "max_sentinels",
      "max_janus",
    ]);
    for (const key of Object.keys(config.concurrency)) {
      assertNumber(config.concurrency[key], `concurrency.${key}`);
    }
  }

  if ("budgets" in config) {
    assertRecord(config.budgets, "budgets");
    validateKnownKeys(config.budgets, "budgets", [
      "oracle",
      "titan",
      "sentinel",
      "janus",
    ]);
    for (const key of Object.keys(config.budgets)) {
      assertRecord(config.budgets[key], `budgets.${key}`);
      validateKnownKeys(config.budgets[key], `budgets.${key}`, [
        "turns",
        "tokens",
      ]);
      if ("turns" in config.budgets[key]) {
        assertNumber(config.budgets[key].turns, `budgets.${key}.turns`);
      }
      if ("tokens" in config.budgets[key]) {
        assertNumber(config.budgets[key].tokens, `budgets.${key}.tokens`);
      }
    }
  }

  if ("thresholds" in config) {
    assertRecord(config.thresholds, "thresholds");
    validateKnownKeys(config.thresholds, "thresholds", [
      "poll_interval_seconds",
      "stuck_warning_seconds",
      "stuck_kill_seconds",
      "allow_complex_auto_dispatch",
      "scope_overlap_threshold",
      "janus_retry_threshold",
    ]);

    for (const key of [
      "poll_interval_seconds",
      "stuck_warning_seconds",
      "stuck_kill_seconds",
      "scope_overlap_threshold",
      "janus_retry_threshold",
    ] as const) {
      if (key in config.thresholds) {
        assertNumber(config.thresholds[key], `thresholds.${key}`);
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
    validateKnownKeys(config.economics, "economics", [
      "metering_fallback",
      "per_issue_cost_warning_usd",
      "daily_cost_warning_usd",
      "daily_hard_stop_usd",
      "quota_warning_floor_pct",
      "quota_hard_stop_floor_pct",
      "credit_warning_floor",
      "credit_hard_stop_floor",
      "allow_exact_cost_estimation",
    ]);
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
    validateKnownKeys(config.janus, "janus", [
      "enabled",
      "max_invocations_per_issue",
    ]);
    if ("enabled" in config.janus) {
      assertBoolean(config.janus.enabled, "janus.enabled");
    }
    if ("max_invocations_per_issue" in config.janus) {
      assertNumber(
        config.janus.max_invocations_per_issue,
        "janus.max_invocations_per_issue",
      );
    }
  }

  if ("mnemosyne" in config) {
    assertRecord(config.mnemosyne, "mnemosyne");
    validateKnownKeys(config.mnemosyne, "mnemosyne", [
      "max_records",
      "prompt_token_budget",
    ]);
    if ("max_records" in config.mnemosyne) {
      assertNumber(config.mnemosyne.max_records, "mnemosyne.max_records");
    }
    if ("prompt_token_budget" in config.mnemosyne) {
      assertNumber(
        config.mnemosyne.prompt_token_budget,
        "mnemosyne.prompt_token_budget",
      );
    }
  }

  if ("labor" in config) {
    assertRecord(config.labor, "labor");
    validateKnownKeys(config.labor, "labor", ["base_path"]);
    if ("base_path" in config.labor) {
      assertString(config.labor.base_path, "labor.base_path");
    }
  }

  if ("olympus" in config) {
    assertRecord(config.olympus, "olympus");
    validateKnownKeys(config.olympus, "olympus", ["port", "open_browser"]);
    if ("port" in config.olympus) {
      assertNumber(config.olympus.port, "olympus.port");
    }
    if ("open_browser" in config.olympus) {
      assertBoolean(config.olympus.open_browser, "olympus.open_browser");
    }
  }

  if ("evals" in config) {
    assertRecord(config.evals, "evals");
    validateKnownKeys(config.evals, "evals", [
      "enabled",
      "results_path",
      "benchmark_suite",
      "minimum_pass_rate",
      "max_human_interventions_per_10_issues",
    ]);
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
      assertNumber(config.evals.minimum_pass_rate, "evals.minimum_pass_rate");
    }
    if ("max_human_interventions_per_10_issues" in config.evals) {
      assertNumber(
        config.evals.max_human_interventions_per_10_issues,
        "evals.max_human_interventions_per_10_issues",
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
