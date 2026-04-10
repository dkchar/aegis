export type StartupPreflightCheckId =
  | "git_repo"
  | "beads_cli"
  | "beads_repo"
  | "aegis_config"
  | "runtime_adapter"
  | "runtime_local_config"
  | "model_refs"
  | "runtime_state_paths";

export type StartupPreflightCheckStatus = "pass" | "fail" | "skipped";
export type StartupPreflightOverallStatus = "ready" | "blocked";

export interface StartupPreflightConfig {
  runtime: string;
  models: Record<string, string>;
}

export interface StartupPreflightProbeResult {
  ok: boolean;
  detail?: string;
  fix?: string;
}

export interface StartupPreflightCheck {
  id: StartupPreflightCheckId;
  label: string;
  status: StartupPreflightCheckStatus;
  detail: string;
  fix?: string;
}

export interface StartupPreflightReport {
  overall: StartupPreflightOverallStatus;
  repoRoot: string;
  checks: StartupPreflightCheck[];
}

export interface StartupPreflightDependencies {
  verifyGitRepo: () => void;
  probeBeadsCli: () => StartupPreflightProbeResult;
  probeBeadsRepo: () => StartupPreflightProbeResult;
  loadConfig: () => StartupPreflightConfig;
  verifyRuntimeAdapter: (
    config: StartupPreflightConfig,
  ) => StartupPreflightProbeResult;
  verifyRuntimeLocalConfig: (
    config: StartupPreflightConfig,
  ) => StartupPreflightProbeResult;
  verifyModelRefs: (
    config: StartupPreflightConfig,
  ) => StartupPreflightProbeResult;
  verifyRuntimeStatePaths: (repoRoot: string) => StartupPreflightProbeResult;
}

const CHECK_ORDER: readonly StartupPreflightCheckId[] = [
  "git_repo",
  "beads_cli",
  "beads_repo",
  "aegis_config",
  "runtime_adapter",
  "runtime_local_config",
  "model_refs",
  "runtime_state_paths",
];

const CHECK_LABELS: Record<StartupPreflightCheckId, string> = {
  git_repo: "git repo",
  beads_cli: "beads cli",
  beads_repo: "beads repo",
  aegis_config: "aegis config",
  runtime_adapter: "runtime adapter",
  runtime_local_config: "runtime local config",
  model_refs: "model refs",
  runtime_state_paths: "runtime state paths",
};

const PASS_DETAILS: Record<StartupPreflightCheckId, string> = {
  git_repo: "Inside a git worktree.",
  beads_cli: "Beads CLI is available.",
  beads_repo: "Beads tracker is initialized.",
  aegis_config: "Config loaded.",
  runtime_adapter: "Runtime adapter is supported.",
  runtime_local_config: "Runtime local config is valid.",
  model_refs: "Configured model refs are valid.",
  runtime_state_paths: "Runtime state paths are available.",
};

function toThrownMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

function toCheckFromProbe(
  id: StartupPreflightCheckId,
  probe: StartupPreflightProbeResult,
): StartupPreflightCheck {
  return {
    id,
    label: CHECK_LABELS[id],
    status: probe.ok ? "pass" : "fail",
    detail: probe.detail ?? PASS_DETAILS[id],
    fix: probe.fix,
  };
}

function failCheck(
  id: StartupPreflightCheckId,
  detail: string,
): StartupPreflightCheck {
  return {
    id,
    label: CHECK_LABELS[id],
    status: "fail",
    detail,
  };
}

function skipCheck(id: StartupPreflightCheckId): StartupPreflightCheck {
  return {
    id,
    label: CHECK_LABELS[id],
    status: "skipped",
    detail: "Skipped because an earlier preflight check failed.",
  };
}

function blockFrom(
  repoRoot: string,
  checks: StartupPreflightCheck[],
  firstSkippedId: StartupPreflightCheckId,
): StartupPreflightReport {
  const firstSkippedIndex = CHECK_ORDER.indexOf(firstSkippedId);

  for (const id of CHECK_ORDER.slice(firstSkippedIndex)) {
    checks.push(skipCheck(id));
  }

  return {
    overall: "blocked",
    repoRoot,
    checks,
  };
}

function pushProbeCheck(
  checks: StartupPreflightCheck[],
  id: StartupPreflightCheckId,
  callback: () => StartupPreflightProbeResult,
): boolean {
  try {
    const check = toCheckFromProbe(id, callback());
    checks.push(check);
    return check.status !== "fail";
  } catch (error) {
    checks.push(failCheck(id, toThrownMessage(error)));
    return false;
  }
}

export function runStartupPreflight(
  repoRoot: string,
  deps: StartupPreflightDependencies,
): StartupPreflightReport {
  const checks: StartupPreflightCheck[] = [];

  try {
    deps.verifyGitRepo();
    checks.push({
      id: "git_repo",
      label: CHECK_LABELS.git_repo,
      status: "pass",
      detail: PASS_DETAILS.git_repo,
    });
  } catch (error) {
    checks.push(failCheck("git_repo", toThrownMessage(error)));
    return blockFrom(repoRoot, checks, "beads_cli");
  }

  if (!pushProbeCheck(checks, "beads_cli", deps.probeBeadsCli)) {
    return blockFrom(repoRoot, checks, "beads_repo");
  }

  if (!pushProbeCheck(checks, "beads_repo", deps.probeBeadsRepo)) {
    return blockFrom(repoRoot, checks, "aegis_config");
  }

  let config: StartupPreflightConfig;

  try {
    config = deps.loadConfig();
    checks.push({
      id: "aegis_config",
      label: CHECK_LABELS.aegis_config,
      status: "pass",
      detail: PASS_DETAILS.aegis_config,
    });
  } catch (error) {
    checks.push(failCheck("aegis_config", toThrownMessage(error)));
    return blockFrom(repoRoot, checks, "runtime_adapter");
  }

  if (!pushProbeCheck(checks, "runtime_adapter", () => deps.verifyRuntimeAdapter(config))) {
    return blockFrom(repoRoot, checks, "runtime_local_config");
  }

  if (!pushProbeCheck(checks, "runtime_local_config", () => deps.verifyRuntimeLocalConfig(config))) {
    return blockFrom(repoRoot, checks, "model_refs");
  }

  if (!pushProbeCheck(checks, "model_refs", () => deps.verifyModelRefs(config))) {
    return blockFrom(repoRoot, checks, "runtime_state_paths");
  }

  if (!pushProbeCheck(checks, "runtime_state_paths", () => deps.verifyRuntimeStatePaths(repoRoot))) {
    return {
      overall: "blocked",
      repoRoot,
      checks,
    };
  }

  return {
    overall: "ready",
    repoRoot,
    checks,
  };
}

export function formatStartupPreflight(report: StartupPreflightReport) {
  const lines = [
    `Aegis startup preflight: ${report.overall}`,
    `repo: ${report.repoRoot}`,
  ];

  for (const check of report.checks) {
    lines.push(`- [${check.status}] ${check.label}: ${check.detail}`);
    if (check.fix) {
      lines.push(`  fix: ${check.fix}`);
    }
  }

  return lines.join("\n");
}
