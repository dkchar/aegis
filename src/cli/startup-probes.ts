import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { CASTE_CONFIG_KEYS } from "../config/caste-config.js";
import { AEGIS_DIRECTORY, RUNTIME_STATE_FILES, type AegisConfig } from "../config/schema.js";
import { CLAUDE_PROVIDER, parseClaudeModelReference } from "../runtime/claude-caste-runtime.js";
import { verifyConfiguredPiModels } from "../runtime/pi-model-config.js";
import { RUNTIME_ADAPTER_NAMES, isRuntimeAdapterName } from "../runtime/runtime-registry.js";
import { buildCliSpawnInvocation } from "../runtime/workspace-processes.js";
import { isGitWorkingTree } from "../shared/git.js";
import type { StartupPreflightProbeResult } from "./startup-preflight.js";

/** Concrete checks behind `aegis start` preflight. Each returns a typed probe result. */

export function verifyGitRepository(root: string) {
  if (!isGitWorkingTree(root)) {
    throw new Error("Aegis start requires a git repository root.");
  }
}

export function probeAgoraTrackerBackend(_root: string): StartupPreflightProbeResult {
  return {
    ok: true,
    detail: "Agora tracker backend is available.",
  };
}

export function verifyRuntimeAdapter(config: AegisConfig): StartupPreflightProbeResult {
  if (!isRuntimeAdapterName(config.runtime)) {
    return {
      ok: false,
      detail: `Unsupported runtime adapter: ${config.runtime}`,
      fix: `set \`.aegis/config.json\` \`runtime\` to one of ${RUNTIME_ADAPTER_NAMES.join(", ")} before starting Aegis`,
    };
  }

  return {
    ok: true,
    detail: `Runtime adapter "${config.runtime}" is supported.`,
  };
}

function resolvePiSettingsPaths(repoRoot: string, env: NodeJS.ProcessEnv) {
  return {
    projectSettingsPath: path.join(repoRoot, ".pi", "settings.json"),
    globalSettingsPath: env.PI_CODING_AGENT_DIR
      ? path.join(env.PI_CODING_AGENT_DIR, "settings.json")
      : path.join(homedir(), ".pi", "agent", "settings.json"),
  };
}

function verifyPiSettings(repoRoot: string, env: NodeJS.ProcessEnv): StartupPreflightProbeResult {
  const { projectSettingsPath, globalSettingsPath } = resolvePiSettingsPaths(repoRoot, env);
  for (const settingsPath of [projectSettingsPath, globalSettingsPath]) {
    if (existsSync(settingsPath)) {
      return {
        ok: true,
        detail: `Pi runtime settings found at ${settingsPath}.`,
      };
    }
  }

  return {
    ok: false,
    detail: `Pi runtime settings were not found. Checked ${projectSettingsPath} and ${globalSettingsPath}.`,
    fix: `create ${projectSettingsPath} for this repository or ${globalSettingsPath} for the current user before starting Aegis`,
  };
}

/** Confirms an adapter CLI is on PATH by running `<command> --version`. */
export function probeCliVersion(command: string, label: string, installHint: string): StartupPreflightProbeResult {
  const invocation = buildCliSpawnInvocation(command, ["--version"]);
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
  });
  if (result.status === 0) {
    const version = `${result.stdout ?? ""}`.trim().split(/\r?\n/)[0] ?? "";
    return {
      ok: true,
      detail: `${label} CLI available${version ? `: ${version}` : ""}.`,
    };
  }

  const reason = result.error?.message ?? `${result.stderr ?? ""}`.trim();
  return {
    ok: false,
    detail: `${label} CLI \`${command}\` is not runnable${reason ? `: ${reason}` : "."}`,
    fix: installHint,
  };
}

export function verifyRuntimeLocalConfig(
  repoRoot: string,
  config: AegisConfig,
  env: NodeJS.ProcessEnv = process.env,
): StartupPreflightProbeResult {
  switch (config.runtime) {
    case "pi":
      return verifyPiSettings(repoRoot, env);
    case "codex":
      return probeCliVersion("codex", "Codex", "install the Codex CLI and sign in before starting Aegis");
    case "claude":
      return probeCliVersion(
        env.AEGIS_CLAUDE_BIN?.trim() || "claude",
        "Claude Code",
        "install Claude Code (`npm install -g @anthropic-ai/claude-code`), run `claude` once to sign in, or set AEGIS_CLAUDE_BIN",
      );
    default:
      return {
        ok: true,
        detail: `Runtime "${config.runtime}" does not require local adapter settings.`,
      };
  }
}

function verifyClaudeModelRefs(config: AegisConfig): StartupPreflightProbeResult {
  const invalid = CASTE_CONFIG_KEYS
    .map((caste) => [caste, parseClaudeModelReference(config.models[caste], config.thinking[caste])] as const)
    .filter(([, model]) => model.provider !== CLAUDE_PROVIDER || model.modelId === "unknown");

  if (invalid.length > 0) {
    return {
      ok: false,
      detail: `Claude runtime needs anthropic:<model-id> refs; invalid: ${invalid
        .map(([caste, model]) => `${caste}=${model.reference}`)
        .join(", ")}.`,
      fix: "set `.aegis/config.json` models to refs such as `anthropic:claude-opus-5-5`",
    };
  }

  return {
    ok: true,
    detail: "Configured Claude model refs are well formed.",
  };
}

/** Model reference validation for the configured adapter. */
export function verifyConfiguredModelRefs(config: AegisConfig): StartupPreflightProbeResult {
  if (config.runtime === "pi") {
    return verifyConfiguredPiModels(config);
  }
  if (config.runtime === "claude") {
    return verifyClaudeModelRefs(config);
  }

  return {
    ok: true,
    detail: `Runtime "${config.runtime}" resolves model refs at session start.`,
  };
}

export function verifyRuntimeStatePaths(repoRoot: string): StartupPreflightProbeResult {
  const aegisDir = path.join(repoRoot, AEGIS_DIRECTORY);

  if (!existsSync(aegisDir)) {
    return {
      ok: false,
      detail: `Missing Aegis runtime directory at ${aegisDir}.`,
      fix: "run `aegis init` in this repository before starting Aegis",
    };
  }

  const missingBootstrapFiles = RUNTIME_STATE_FILES
    .map((relativePath) => path.join(repoRoot, ...relativePath.split("/")))
    .filter((candidate) => !existsSync(candidate));

  if (missingBootstrapFiles.length > 0) {
    return {
      ok: false,
      detail: `Missing Aegis bootstrap state files: ${missingBootstrapFiles.join(", ")}.`,
      fix: "run `aegis init` to seed the required `.aegis` state files before starting Aegis",
    };
  }

  try {
    accessSync(aegisDir, constants.R_OK | constants.W_OK);
  } catch {
    return {
      ok: false,
      detail: `Aegis cannot write runtime state under ${aegisDir}.`,
      fix: "fix repository permissions so Aegis can read and write files under `.aegis/`",
    };
  }

  return {
    ok: true,
    detail: "Runtime state paths are available.",
  };
}
