import type { CasteRuntime } from "./caste-runtime.js";
import type { CasteName } from "./caste-runtime.js";
import { PiCasteRuntime } from "./pi-caste-runtime.js";
import { CodexCasteRuntime, createCodexModelConfigs } from "./codex-caste-runtime.js";
import {
  ClaudeCasteRuntime,
  createClaudeModelConfigs,
  resolveClaudeRuntimeOptionsFromEnv,
} from "./claude-caste-runtime.js";
import {
  createDefaultScriptedCasteRuntime,
  createScriptedModelConfigs,
} from "./scripted-caste-runtime.js";
import { loadConfig } from "../config/load-config.js";
import { createCasteConfig } from "../config/caste-config.js";
import { resolveConfiguredCasteModel } from "./pi-model-config.js";

export interface CreateCasteRuntimeOptions {
  createPiRuntime?: () => CasteRuntime;
  createScriptedRuntime?: () => CasteRuntime;
  createCodexRuntime?: () => CasteRuntime;
  createClaudeRuntime?: () => CasteRuntime;
}

export interface CreateCasteRuntimeContext {
  root?: string;
  issueId?: string;
}

function parseNonNegativeInteger(value: string | undefined) {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

function parsePositiveInteger(value: string | undefined) {
  const parsed = parseNonNegativeInteger(value);
  if (parsed === undefined || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

export function resolvePiRuntimeOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
) {
  const sessionTimeoutMs = parsePositiveInteger(env.AEGIS_PI_SESSION_TIMEOUT_MS);
  const sessionTimeoutMsByCaste = {
    oracle: parsePositiveInteger(env.AEGIS_PI_ORACLE_TIMEOUT_MS),
    titan: parsePositiveInteger(env.AEGIS_PI_TITAN_TIMEOUT_MS),
    sentinel: parsePositiveInteger(env.AEGIS_PI_SENTINEL_TIMEOUT_MS),
    janus: parsePositiveInteger(env.AEGIS_PI_JANUS_TIMEOUT_MS),
  } satisfies Partial<Record<CasteName, number>>;
  const timeoutRetryCount = parseNonNegativeInteger(env.AEGIS_PI_TIMEOUT_RETRY_COUNT);
  const timeoutRetryDelayMs = parseNonNegativeInteger(env.AEGIS_PI_TIMEOUT_RETRY_DELAY_MS);

  return {
    ...(sessionTimeoutMs !== undefined ? { sessionTimeoutMs } : {}),
    ...(Object.values(sessionTimeoutMsByCaste).some((value) => value !== undefined)
      ? { sessionTimeoutMsByCaste }
      : {}),
    ...(timeoutRetryCount !== undefined ? { timeoutRetryCount } : {}),
    ...(timeoutRetryDelayMs !== undefined ? { timeoutRetryDelayMs } : {}),
  };
}

/**
 * Builds the direct caste runtime for an adapter name. Unknown names fall back
 * to the scripted runtime so seam tests never reach a live model by accident;
 * the daemon rejects unknown adapters during startup preflight.
 */
export function createCasteRuntime(
  runtime: string,
  options: CreateCasteRuntimeOptions = {},
  context: CreateCasteRuntimeContext = {},
): CasteRuntime {
  const config = context.root ? loadConfig(context.root) : null;

  if (runtime === "pi") {
    return options.createPiRuntime?.() ?? new PiCasteRuntime(
      config ? createCasteConfig((caste) => resolveConfiguredCasteModel(config, caste)) : {},
      resolvePiRuntimeOptionsFromEnv(),
    );
  }

  if (runtime === "codex") {
    return options.createCodexRuntime?.() ?? new CodexCasteRuntime(
      config ? createCodexModelConfigs(config.models, config.thinking) : {},
    );
  }

  if (runtime === "claude") {
    return options.createClaudeRuntime?.() ?? new ClaudeCasteRuntime(
      config ? createClaudeModelConfigs(config.models, config.thinking) : {},
      resolveClaudeRuntimeOptionsFromEnv(),
    );
  }

  return options.createScriptedRuntime?.() ?? createDefaultScriptedCasteRuntime(
    config ? createScriptedModelConfigs(config.models, config.thinking) : {},
    context.root,
    context.issueId,
  );
}
