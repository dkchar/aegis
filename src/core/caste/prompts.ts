import { JANUS_EMIT_RESOLUTION_TOOL_NAME } from "../../castes/janus/janus-tool-contract.js";
import { ORACLE_EMIT_ASSESSMENT_TOOL_NAME } from "../../castes/oracle/oracle-tool-contract.js";
import { SENTINEL_EMIT_VERDICT_TOOL_NAME } from "../../castes/sentinel/sentinel-tool-contract.js";
import { TITAN_EMIT_ARTIFACT_TOOL_NAME } from "../../castes/titan/titan-tool-contract.js";
import {
  ALLOWED_FILE_SCOPE_PREFIX,
  extractDeclaredFileScope,
  isPolicyCreatedBlockerDescription,
} from "../../castes/scope-markers.js";
import type { AegisIssue } from "../../tracker/issue-model.js";
import type { ArtifactEmissionMode, JanusConflictContext } from "./types.js";

/**
 * Caste prompt builders. Prompts explain intent to the agent; every rule here
 * that matters for correctness is also enforced mechanically after the session
 * (artifact parsers, git proof, scope validation, mutation policy).
 */

export const AEGIS_CASTE_SESSION_GUARD = [
  "You are a dispatched Aegis caste subagent running one bounded assignment in its assigned working directory.",
  "If local agent skills or workflow guides mention SUBAGENT-STOP, that applies to this session; skip those skills and follow this Aegis prompt directly.",
  "Do not invoke or read local assistant skills, plugin workflows, or broad development playbooks unless this prompt explicitly asks for them.",
];

/**
 * Terminal rules for caste shells. Every adapter's shell must return control
 * (no servers, watchers, or GUIs); Windows sessions additionally get the
 * PowerShell quirks that otherwise fail adapter commands.
 */
export function buildTerminalGuard(platform: NodeJS.Platform = process.platform) {
  const npm = platform === "win32" ? "npm.cmd" : "npm";
  return [
    "Terminal guard: every command must finish and return to the shell. Do not open GUIs or browsers for checks.",
    `Do not run dev, preview, watch, or server commands such as ${npm} run dev, ${npm} run preview, vite, next dev, vitest --watch, or tsc --watch; they are killed and fail the session. Use finite checks like ${npm} run build or ${npm} test.`,
    ...(platform === "win32"
      ? [
        "Windows command guard: run package-manager commands as npm.cmd, npx.cmd, pnpm.cmd, yarn.cmd, or bun.cmd; never invoke .ps1 scripts directly or use Start-Process/Invoke-Item.",
        "Guard optional file reads and probes so missing paths do not exit nonzero: use Test-Path before Get-Content, rg --files before reading discovered paths, or handle expected misses explicitly.",
        "PowerShell `rg` no-match exits 1 and fails the adapter. For exploratory searches where no match is acceptable, wrap it as: rg -n \"pattern\" path; if ($LASTEXITCODE -eq 1) { exit 0 }.",
      ]
      : []),
  ];
}

function formatFailureSteering(failureSteering: string[] | undefined) {
  return failureSteering?.length
    ? ["Failure steering:", failureSteering.map((entry) => `- ${entry}`).join("\n")]
    : [];
}

function artifactEmissionInstruction(
  toolName: string,
  phase: string,
  mode: ArtifactEmissionMode | undefined,
) {
  if (mode === "json") {
    return `Return the final artifact as the JSON object itself after ${phase}; no ${toolName} tool call is available in this adapter.`;
  }

  return `Call tool '${toolName}' exactly once as final step after ${phase}.`;
}

export function buildOraclePrompt(
  issue: AegisIssue,
  emissionMode?: ArtifactEmissionMode,
  failureSteering?: string[],
) {
  const description = issue.description?.trim() || "No description provided.";
  const blockers = issue.blockers.length > 0 ? issue.blockers.join(", ") : "none";
  const labels = issue.labels.length > 0 ? issue.labels.join(", ") : "none";
  const declaredScope = (issue.fileScope?.length ?? 0) > 0
    ? issue.fileScope!
    : extractDeclaredFileScope(issue.description);

  return [
    ...AEGIS_CASTE_SESSION_GUARD,
    `Scout ${issue.id}: ${issue.title}`,
    `Description: ${description}`,
    `Status: ${issue.status}`,
    `Blockers: ${blockers}`,
    `Labels: ${labels}`,
    ...(declaredScope.length > 0
      ? [`Declared file ownership: ${declaredScope.join(", ")}`]
      : []),
    ...formatFailureSteering(failureSteering),
    "Produce only scout context: files, risks, suggested checks, and scope notes.",
    ...buildTerminalGuard(),
    "Do not decide readiness, do not decompose, and do not propose new issues.",
    artifactEmissionInstruction(ORACLE_EMIT_ASSESSMENT_TOOL_NAME, "analysis is complete", emissionMode),
    "Return only JSON. No markdown fences. No prose before or after JSON.",
    "JSON schema keys: files_affected, estimated_complexity, risks, suggested_checks, scope_notes.",
    "files_affected must be an array of path strings, not objects.",
    "estimated_complexity allowed values: trivial, moderate, complex.",
  ].join("\n");
}

export function buildTitanPrompt(
  issue: AegisIssue,
  laborPath: string,
  options?: {
    fileScope?: { files: string[] } | null;
    suggestedChecks?: string[];
    scopeNotes?: string[];
    reviewFeedback?: string[];
    failureSteering?: string[];
    resolvedBlockerIssueId?: string | null;
    requiresIntegrationRework?: boolean;
    artifactEmissionMode?: ArtifactEmissionMode;
  },
) {
  const description = issue.description?.trim() || "No description provided.";
  const blockers = issue.blockers.length > 0 ? issue.blockers.join(", ") : "none";
  const labels = issue.labels.length > 0 ? issue.labels.join(", ") : "none";
  const fileScope = options?.fileScope?.files.length
    ? options.fileScope.files.join(", ")
    : null;
  const scopeNotes = options?.scopeNotes?.length
    ? options.scopeNotes.map((entry) => `- ${entry}`).join("\n")
    : null;
  const suggestedChecks = options?.suggestedChecks?.length
    ? options.suggestedChecks.map((entry) => `- ${entry}`).join("\n")
    : null;
  const reviewFeedback = options?.reviewFeedback?.length
    ? options.reviewFeedback.map((entry) => `- ${entry}`).join("\n")
    : null;
  const resolvedBlockerIssueId = options?.resolvedBlockerIssueId ?? null;
  const isPolicyCreatedBlocker = isPolicyCreatedBlockerDescription(description);

  return [
    ...AEGIS_CASTE_SESSION_GUARD,
    `Implement issue ${issue.id}.`,
    `Title: ${issue.title}`,
    `Description: ${description}`,
    `Status: ${issue.status}`,
    `Blockers: ${blockers}`,
    `Labels: ${labels}`,
    `Working directory: ${laborPath}`,
    ...(fileScope
      ? [
        `${ALLOWED_FILE_SCOPE_PREFIX} ${fileScope}`,
        "Current allowed file scope is authoritative for this issue.",
        "Stay within the allowed file scope. If required work is truly outside that scope, emit a blocking mutation_proposal instead of editing unrelated files.",
      ]
      : []),
    ...(reviewFeedback
      ? [
        "Rework priority from prior Sentinel or Janus feedback:",
        reviewFeedback,
        isPolicyCreatedBlocker
          ? "Resolve this feedback before returning success or explicit failure."
          : "Resolve this feedback before returning success or already_satisfied.",
        "If resolving this feedback requires files outside the allowed file scope, emit a blocking mutation_proposal instead of repeating the same handoff.",
      ]
      : []),
    ...(scopeNotes
      ? [
        "Oracle scope notes:",
        scopeNotes,
      ]
      : []),
    ...(suggestedChecks
      ? [
        "Oracle suggested checks:",
        suggestedChecks,
      ]
      : []),
    ...formatFailureSteering(options?.failureSteering),
    ...(options?.requiresIntegrationRework
      ? [
        "Janus integration rework: the previous candidate failed at the merge boundary.",
        "Do not return already_satisfied for Janus integration rework.",
        "Create a new in-scope commit that resolves the merge-boundary conflict against the current base branch.",
      ]
      : []),
    ...(resolvedBlockerIssueId
      ? [
        `Previously blocked by child issue ${resolvedBlockerIssueId}. Tracker now reports this parent ready, so the child is closed.`,
        "Do not create another blocker for the same out-of-scope need; inspect the current workspace and continue remaining owned-scope work. If the issue contract is already satisfied, return already_satisfied.",
      ]
      : []),
    ...(isPolicyCreatedBlocker
      ? [
        "Policy-created blocker issue: this issue exists to resolve a previously accepted blocking mutation proposal.",
        "Do not resolve this blocker with already_satisfied. Make the required in-scope change and return success, or return failure with evidence if the blocker cannot be resolved.",
        "Do not create another blocker from this issue; policy-created blockers must terminate with success or failure.",
      ]
      : []),
    "Preserve existing Aegis operational files and ignore rules. Do not modify .aegis/ or remove its existing .gitignore coverage.",
    ...buildTerminalGuard(),
    "Oracle suggested checks are advisory; skip checks that require files or package manifests outside the allowed file scope.",
    "If a terminal command is rejected by the Aegis guard, do not retry variants of the same rejected command. Continue with in-scope edits and report the skipped check or guard rejection in tests_and_checks_run or known_risks.",
    "When you make implementation edits, stage and commit all intended changes in the labor worktree before you call the final artifact tool so the candidate branch head advances.",
    "Use git add/git commit explicitly when files_changed is non-empty.",
    "Do not leave required implementation changes uncommitted.",
    "Inspect the current worktree before trusting prior feedback; stale Sentinel or Janus prose is context, not truth.",
    "If owned smoke tests exist, npm run smoke must execute those owned tests or you must wire the owned smoke script before claiming the gate is blocked elsewhere.",
    "A static HTML/asset smoke check is insufficient when owned browser smoke tests exercise product behavior.",
    "If a finite Node smoke script starts an HTTP server and runs browser tests, use asynchronous child process APIs so the server event loop can respond; do not use spawnSync or execFileSync in that hosted server process.",
    ...(isPolicyCreatedBlocker
      ? [
        "For this policy-created blocker, do not use outcome 'already_satisfied' even if prior merged work appears to satisfy the issue.",
        "If prior merged work now satisfies this blocker, run finite verification checks, make no edits, skip git commit, and emit outcome 'success' with files_changed=[].",
      ]
      : [
        "If the issue contract is already satisfied by prior merged work, make no edits and emit outcome 'already_satisfied' with files_changed=[] and the checks you ran.",
      ]),
    "Report files_changed as paths relative to the working directory, never as absolute paths.",
    artifactEmissionInstruction(TITAN_EMIT_ARTIFACT_TOOL_NAME, "all file edits and checks complete", options?.artifactEmissionMode),
    "If required project files do not exist, create minimal versions that satisfy the issue contract.",
    "Treat ordinary naming/tooling ambiguity as solvable: choose reasonable defaults and proceed.",
    "Use mutation_proposal only for hard blocking missing work: clarification, prerequisite, or required out-of-scope dependency.",
    "Do not create non-blocking follow-up work.",
    "Return only JSON. No markdown fences. No prose before or after JSON.",
    "JSON schema keys: outcome, summary, files_changed, tests_and_checks_run, known_risks, follow_up_work, optional mutation_proposal.",
    "Allowed outcome values: success, already_satisfied, clarification, failure.",
    "mutation_proposal keys: proposal_type, summary, suggested_title, suggested_description, scope_evidence.",
    "Allowed mutation_proposal.proposal_type values: create_clarification_blocker, create_prerequisite_blocker, create_out_of_scope_blocker.",
  ].join("\n");
}

export function buildSentinelPrompt(
  issue: AegisIssue,
  options?: {
    fileScope?: { files: string[] } | null;
    titanReviewContext?: string[];
    failureSteering?: string[];
    emissionMode?: ArtifactEmissionMode;
  },
) {
  const description = issue.description?.trim() || "No description provided.";
  const fileScope = options?.fileScope?.files.length
    ? options.fileScope.files.join(", ")
    : null;
  return [
    ...AEGIS_CASTE_SESSION_GUARD,
    `Pre-merge review issue ${issue.id}.`,
    `Title: ${issue.title}`,
    `Description: ${description}`,
    ...(fileScope
      ? [
        `${ALLOWED_FILE_SCOPE_PREFIX} ${fileScope}`,
        "Current allowed file scope is authoritative for this review.",
      ]
      : []),
    "Return binary control verdict pass or fail_blocking.",
    ...formatFailureSteering(options?.failureSteering),
    ...buildTerminalGuard(),
    "Sentinel is review-only. Do not edit files, repair defects, or complete missing work.",
    "If the candidate is incomplete, truncated, missing owned content, or otherwise fails the issue contract, emit fail_blocking with route=rework_owner.",
    ...(options?.titanReviewContext?.length ? options.titanReviewContext : []),
    "Blocking findings must only cover original issue contract, regressions in touched scope, or required out-of-scope blockers.",
    "blockingFindings must be typed objects with fields: finding_kind, summary, required_files, owner_issue, route.",
    "Allowed finding_kind: contract_gap, regression, out_of_scope_blocker, integration_blocker.",
    "Use route=rework_owner for in-scope parent rework. Use route=create_blocker only when required files are outside the owner issue scope.",
    "Sentinel does not create issues. Aegis router handles create_blocker findings deterministically after the verdict.",
    "Advisories are logged only and must not create issues.",
    artifactEmissionInstruction(SENTINEL_EMIT_VERDICT_TOOL_NAME, "review is complete", options?.emissionMode),
    "Return only JSON. No markdown fences. No prose before or after JSON.",
    "JSON schema keys: verdict, reviewSummary, blockingFindings, advisories, touchedFiles, contractChecks.",
    "touchedFiles and contractChecks must be arrays of strings. blockingFindings must be an array of typed objects, not strings.",
  ].join("\n");
}

export function buildJanusPrompt(
  issue: AegisIssue,
  janusContext?: JanusConflictContext,
  emissionMode?: ArtifactEmissionMode,
  failureSteering?: string[],
) {
  const description = issue.description?.trim() || "No description provided.";
  const contextLines = janusContext
    ? [
      `Merge queue item: ${janusContext.queueItemId}`,
      `Merge tier: ${janusContext.tier}`,
      `Merge attempt: ${janusContext.attempt}`,
      `Janus invocation: ${janusContext.janusInvocation}`,
      `Merge outcome: ${janusContext.mergeOutcome}`,
      `Merge detail: ${janusContext.mergeDetail}`,
    ]
    : [];

  return [
    ...AEGIS_CASTE_SESSION_GUARD,
    `Process integration conflict for issue ${issue.id}.`,
    `Title: ${issue.title}`,
    `Description: ${description}`,
    ...contextLines,
    ...formatFailureSteering(failureSteering),
    ...buildTerminalGuard(),
    artifactEmissionInstruction(JANUS_EMIT_RESOLUTION_TOOL_NAME, "conflict analysis is complete", emissionMode),
    "Return only JSON. No markdown fences. No prose before or after JSON.",
    "JSON schema keys: originatingIssueId, queueItemId, preservedLaborPath, conflictSummary, resolutionStrategy, filesTouched, validationsRun, residualRisks, mutation_proposal.",
    "mutation_proposal keys: proposal_type, summary, suggested_title, suggested_description, scope_evidence.",
    "Allowed mutation_proposal.proposal_type values: requeue_parent, create_integration_blocker.",
  ].join("\n");
}
