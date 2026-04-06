$ErrorActionPreference = 'Stop'

$programId = 'aegis-fjm'
$trackerDataPath = 'plandocs/2026-04-03-aegis-mvp-tracker-data.json'
$trackerMarkdownPath = 'plandocs/2026-04-03-aegis-mvp-tracker.md'
$existingEvidenceBySlice = @{}
$existingIssueStatusById = @{}

function Run-Bd {
  param([Parameter(Mandatory = $true)][string[]]$Args)
  $output = & bd --sandbox --dolt-auto-commit on @Args 2>&1
  if ($LASTEXITCODE -ne 0) {
    $joined = ($output | Out-String).Trim()
    throw "bd $($Args -join ' ') failed with exit code $LASTEXITCODE`n$joined"
  }
  return $output
}

function Read-Bd {
  param([Parameter(Mandatory = $true)][string[]]$Args)
  $output = & bd --sandbox @Args 2>&1
  if ($LASTEXITCODE -ne 0) {
    $joined = ($output | Out-String).Trim()
    throw "bd $($Args -join ' ') failed with exit code $LASTEXITCODE`n$joined"
  }
  return $output
}

function Read-BdJson {
  param([Parameter(Mandatory = $true)][string[]]$Args)
  $raw = Read-Bd -Args $Args
  return (($raw | Out-String).Trim()) | ConvertFrom-Json
}

if (Test-Path $trackerDataPath) {
  $existingTracker = Get-Content -Path $trackerDataPath -Raw | ConvertFrom-Json
  foreach ($existingSlice in $existingTracker.slices) {
    $existingEvidenceBySlice[$existingSlice.key] = [ordered]@{
      automated = if ($existingSlice.PSObject.Properties.Name -contains 'evidence_automated') { $existingSlice.evidence_automated } else { 'pending' }
      manual = if ($existingSlice.PSObject.Properties.Name -contains 'evidence_manual') { $existingSlice.evidence_manual } else { 'pending' }
      notes = if ($existingSlice.PSObject.Properties.Name -contains 'evidence_notes') { $existingSlice.evidence_notes } else { '' }
      updated_at = if ($existingSlice.PSObject.Properties.Name -contains 'evidence_updated_at') { $existingSlice.evidence_updated_at } else { '' }
    }
  }
}

$existingIssues = Read-BdJson -Args @('list', '--json', '--status', 'all', '--limit', '400')
foreach ($issue in $existingIssues) {
  $existingIssueStatusById[$issue.id] = $issue.status
}

function Update-Issue {
  param(
    [Parameter(Mandatory = $true)][string]$Id,
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Description,
    [string]$Acceptance,
    [Parameter(Mandatory = $true)][string]$Priority,
    [Parameter(Mandatory = $true)][string[]]$Labels,
    [string]$Status
  )

  $args = @('update', $Id, '--title', $Title, '--description', $Description, '--priority', $Priority, '--set-labels', ($Labels -join ','))
  if ($Acceptance) {
    $args += @('--acceptance', $Acceptance)
  }
  if ($Status) {
    $args += @('--status', $Status)
  }
  Run-Bd -Args $args | Out-Null
}

function Ensure-Dependency {
  param(
    [Parameter(Mandatory = $true)][string]$Blocked,
    [Parameter(Mandatory = $true)][string]$Blocker
  )

  try {
    Run-Bd -Args @('dep', 'add', $Blocked, $Blocker) | Out-Null
  } catch {
    if ($_.Exception.Message -notmatch 'already') {
      throw
    }
  }
}

function Remove-Dependency {
  param(
    [Parameter(Mandatory = $true)][string]$Blocked,
    [Parameter(Mandatory = $true)][string]$Blocker
  )

  try {
    Run-Bd -Args @('dep', 'remove', $Blocked, $Blocker) | Out-Null
  } catch {
    if ($_.Exception.Message -notmatch 'not found') {
      throw
    }
  }
}

function Set-Blockers {
  param(
    [Parameter(Mandatory = $true)][string]$Blocked,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Desired
  )

  $deps = Read-BdJson -Args @('dep', 'list', $Blocked, '--json')
  $current = @()
  foreach ($dep in $deps) {
    if ($dep.dependency_type -eq 'blocks') {
      $current += $dep.id
    }
  }

  foreach ($blocker in $current) {
    if ($Desired -notcontains $blocker) {
      Remove-Dependency -Blocked $Blocked -Blocker $blocker
    }
  }

  foreach ($blocker in $Desired) {
    if ($current -notcontains $blocker) {
      Ensure-Dependency -Blocked $Blocked -Blocker $blocker
    }
  }
}

$slices = @(
  [pscustomobject]@{
    Key='S00'; Name='Project Skeleton and Toolchain'; Phase='phase0'; Priority='1'; Epic='aegis-fjm.1'; Contract='aegis-fjm.1.1'; LaneA='aegis-fjm.1.2'; LaneB='aegis-fjm.1.3'; Gate='aegis-fjm.1.4';
    DependsOn=@(); Outcome='Node, TypeScript, Vitest, and Olympus workspace skeleton build cleanly.';
    LaneAText='Scaffold the Node entrypoint, shared path helpers, and baseline scripts.';
    LaneBText='Scaffold the Olympus workspace and frontend build shell.';
    Auto='npm run build; npm run test -- tests/unit/bootstrap/project-skeleton.test.ts';
    Manual='Fresh clone installs and builds on Windows PowerShell and one Unix-like shell.'
  }
  [pscustomobject]@{
    Key='S01'; Name='Config and Filesystem Contracts'; Phase='phase0'; Priority='1'; Epic='aegis-fjm.2'; Contract='aegis-fjm.2.1'; LaneA='aegis-fjm.2.2'; LaneB='aegis-fjm.2.3'; Gate='aegis-fjm.2.4';
    DependsOn=@('S00'); Outcome='The `.aegis` layout, config schema, defaults, and init path are deterministic and idempotent.';
    LaneAText='Implement config parsing, defaults, and validation.';
    LaneBText='Implement `aegis init`, filesystem creation, and `.gitignore` update logic.';
    Auto='npm run test -- tests/unit/config/load-config.test.ts tests/integration/config/init-project.test.ts';
    Manual='`aegis init` creates required files without clobbering existing local config.'
  }
  [pscustomobject]@{
    Key='S02'; Name='Eval Harness Foundation'; Phase='phase05'; Priority='1'; Epic='aegis-fjm.3'; Contract='aegis-fjm.3.1'; LaneA='aegis-fjm.3.2'; LaneB='aegis-fjm.3.3'; Gate='aegis-fjm.3.4';
    DependsOn=@('S06'); Outcome='Aegis can run named scenarios and persist comparable result artifacts.';
    LaneAText='Implement the scenario runner and artifact writer.';
    LaneBText='Implement result schema validation and score summary generation.';
    Auto='npm run test -- tests/unit/evals/result-schema.test.ts tests/integration/evals/run-scenario.test.ts';
    Manual='Running the same scenario twice yields comparable artifacts under `.aegis/evals/`, and a simulated failed run still records a clean failure artifact.'
  }
  [pscustomobject]@{
    Key='S03'; Name='Fixture Repos and Benchmark Corpus'; Phase='phase05'; Priority='2'; Epic='aegis-fjm.4'; Contract='aegis-fjm.4.1'; LaneA='aegis-fjm.4.2'; LaneB='aegis-fjm.4.3'; Gate='aegis-fjm.4.4';
    DependsOn=@('S02'); Outcome='The MVP benchmark corpus has resettable fixture repos and named scenarios.';
    LaneAText='Create clean, complex, and restart fixtures.';
    LaneBText='Create merge-failure, conflict, and polling-only fixtures.';
    Auto='npm run test -- tests/integration/evals/fixture-sanity.test.ts';
    Manual='Each fixture can be reset and run manually without hidden preconditions.'
  }
  [pscustomobject]@{
    Key='S04'; Name='Tracker Adapter and Dispatch Store'; Phase='phase1'; Priority='1'; Epic='aegis-fjm.5'; Contract='aegis-fjm.5.1'; LaneA='aegis-fjm.5.2'; LaneB='aegis-fjm.5.3'; Gate='aegis-fjm.5.4';
    DependsOn=@('S01','S03'); Outcome='Beads task truth and dispatch-state orchestration truth are implemented with explicit stage transitions.';
    LaneAText='Implement Beads reads and structured issue creation/update helpers.';
    LaneBText='Implement dispatch-state persistence, stage transitions, and restart reconciliation.';
    Auto='npm run test -- tests/unit/core/stage-transition.test.ts tests/integration/core/dispatch-state-recovery.test.ts';
    Manual='A new issue starts at `pending`, and an interrupted in-progress record remains reconcilable after restart.'
  }
  [pscustomobject]@{
    Key='S05'; Name='Runtime Contract and Pi Adapter'; Phase='phase1'; Priority='1'; Epic='aegis-fjm.6'; Contract='aegis-fjm.6.1'; LaneA='aegis-fjm.6.2'; LaneB='aegis-fjm.6.3'; Gate='aegis-fjm.6.4';
    DependsOn=@('S01','S03'); Outcome='The orchestration core can spawn, steer, abort, and meter Pi sessions through a stable runtime contract.';
    LaneAText='Implement the `AgentRuntime` boundary and Pi session lifecycle.';
    LaneBText='Implement stats normalization across auth modes and session states.';
    Auto='npm run test -- tests/unit/runtime/normalize-stats.test.ts tests/integration/runtime/pi-runtime.test.ts';
    Manual='A Pi session launches and aborts cleanly from both the project root and a worktree on Windows, and Oracle tool restrictions plus abort-driven cleanup are enforced correctly.'
  }
  [pscustomobject]@{
    Key='S06'; Name='HTTP Server, SSE Bus, and Launch Lifecycle'; Phase='phase0'; Priority='1'; Epic='aegis-fjm.7'; Contract='aegis-fjm.7.1'; LaneA='aegis-fjm.7.2'; LaneB='aegis-fjm.7.3'; Gate='aegis-fjm.7.4';
    DependsOn=@('S00','S01'); Outcome='The orchestrator exposes a basic launch surface, serves the minimal Olympus shell, and provides the control API plus live SSE updates.';
    LaneAText='Implement `aegis start`, `aegis status`, `aegis stop`, prerequisite checks, browser-open behavior, graceful shutdown, and serving the minimal Olympus shell required for Phase 0.';
    LaneBText='Implement REST endpoints, SSE publish/replay transport, and event serialization.';
    Auto='npm run test -- tests/integration/server/routes.test.ts tests/integration/cli/start-stop.test.ts';
    Manual='`aegis start` serves Olympus, optionally opens the browser, `aegis status` reports correctly, and shutdown preserves reconcilable state.'
  }
  [pscustomobject]@{
    Key='S07'; Name='Direct Commands and Operating Modes'; Phase='phase1'; Priority='1'; Epic='aegis-fjm.8'; Contract='aegis-fjm.8.1'; LaneA='aegis-fjm.8.2'; LaneB='aegis-fjm.8.3'; Gate='aegis-fjm.8.4';
    DependsOn=@('S04','S05','S06'); Outcome='The full deterministic MVP command family works in conversational and auto modes.';
    LaneAText='Implement direct command parsing and execution routing.';
    LaneBText='Implement conversational versus auto mode semantics, including new-ready-only auto dispatch.';
    Auto='npm run test -- tests/unit/cli/parse-command.test.ts tests/integration/core/operating-mode.test.ts';
    Manual='Validate parser and routing coverage for `scout`, `implement`, `review`, `process`, `status`, `pause`, `resume`, `auto on/off`, `scale`, `kill`, `restart`, `focus`, `tell`, `add_learning`, `reprioritize`, and `summarize`, and confirm unsupported downstream behaviors fail clearly until their owning slice lands.'
  }
  [pscustomobject]@{
    Key='S08'; Name='Oracle Scouting Pipeline'; Phase='phase1'; Priority='1'; Epic='aegis-fjm.9'; Contract='aegis-fjm.9.1'; LaneA='aegis-fjm.9.2'; LaneB='aegis-fjm.9.3'; Gate='aegis-fjm.9.4';
    DependsOn=@('S04','S05','S06'); Outcome='Oracle runs produce strict `OracleAssessment` artifacts, pause on complex work, and create derived issues when needed.';
    LaneAText='Implement Oracle prompt construction and strict result parsing.';
    LaneBText='Implement scout dispatch, complexity gating, and decomposition issue creation.';
    Auto='npm run test -- tests/unit/castes/oracle/oracle-parser.test.ts tests/integration/core/run-oracle.test.ts';
    Manual='A scout run stores a valid assessment, pauses on `complex`, and links derived issues back to the origin issue.'
  }
  [pscustomobject]@{
    Key='S09'; Name='Titan Pipeline and Labors'; Phase='phase1'; Priority='1'; Epic='aegis-fjm.10'; Contract='aegis-fjm.10.1'; LaneA='aegis-fjm.10.2'; LaneB='aegis-fjm.10.3'; Gate='aegis-fjm.10.4';
    DependsOn=@('S04','S05','S06'); Outcome='Titan runs execute inside isolated Labors and emit handoff and clarification artifacts.';
    LaneAText='Implement worktree creation, cleanup, and preservation behavior.';
    LaneBText='Implement Titan prompt execution, clarification artifact generation, and success/failure transition mapping against the contract-seeded labor interface.';
    Auto='npm run test -- tests/unit/labor/create-labor.test.ts tests/integration/core/run-titan.test.ts';
    Manual='Titan runs in an isolated labor, preserves the workspace on failure, and emits a merge-queue-ready handoff artifact.'
  }
  [pscustomobject]@{
    Key='S09A'; Name='Sentinel Review Pipeline'; Phase='phase1'; Priority='1'; Epic='aegis-fjm.18'; Contract='aegis-fjm.18.1'; LaneA='aegis-fjm.18.2'; LaneB='aegis-fjm.18.3'; Gate='aegis-fjm.18.4';
    DependsOn=@('S07'); Outcome='Sentinel verdicts, corrective work, and review failure handling exist before merge-queue integration.';
    LaneAText='Implement prompt construction, strict verdict parsing, and fix-issue generation.';
    LaneBText='Implement review dispatch, tracker state transitions, and failure handling.';
    Auto='npm run test -- tests/unit/castes/sentinel/sentinel-parser.test.ts tests/integration/core/run-sentinel.test.ts';
    Manual='A direct review run can pass or fail, generate corrective work, and provide the Sentinel failure path required by Phase 1.'
  }
  [pscustomobject]@{
    Key='S10'; Name='Monitor, Reaper, Cooldown, and Recovery'; Phase='phase1'; Priority='1'; Epic='aegis-fjm.11'; Contract='aegis-fjm.11.1'; LaneA='aegis-fjm.11.2'; LaneB='aegis-fjm.11.3'; Gate='aegis-fjm.11.4';
    DependsOn=@('S04','S05','S06','S08','S09','S09A'); Outcome='Budget enforcement, stuck detection, cooldown, and restart recovery are deterministic and persistent.';
    LaneAText='Implement monitor warnings, kills, and live stats updates.';
    LaneBText='Implement reaper transitions, failure accounting, cooldown windows, and recovery.';
    Auto='npm run test -- tests/unit/core/cooldown-policy.test.ts tests/integration/core/monitor-reaper.test.ts';
    Manual='Force one Oracle-tagged, Titan-tagged, and Sentinel-tagged failure through the landed execution paths and confirm the reaper transitions plus three-failure cooldown suppression.'
  }
  [pscustomobject]@{
    Key='S11'; Name='Mnemosyne and Lethe Baseline'; Phase='phase1'; Priority='2'; Epic='aegis-fjm.12'; Contract='aegis-fjm.12.1'; LaneA='aegis-fjm.12.2'; LaneB='aegis-fjm.12.3'; Gate='aegis-fjm.12.4';
    DependsOn=@('S04','S06'); Outcome='Learnings can be written, selected for prompts, and pruned without mixing them with telemetry.';
    LaneAText='Implement JSONL append/read and server-side write paths for Mnemosyne records.';
    LaneBText='Implement prompt injection filtering and Lethe pruning policy.';
    Auto='npm run test -- tests/unit/memory/select-learnings.test.ts tests/integration/memory/mnemosyne-store.test.ts';
    Manual='A learning added through the orchestrator write path is retrievable by the Mnemosyne selector for the next matching prompt context, old records prune correctly, and telemetry stays out of Mnemosyne.'
  }
  [pscustomobject]@{
    Key='S12'; Name='Olympus MVP Shell'; Phase='phase1'; Priority='2'; Epic='aegis-fjm.13'; Contract='aegis-fjm.13.1'; LaneA='aegis-fjm.13.2'; LaneB='aegis-fjm.13.3'; Gate='aegis-fjm.13.4';
    DependsOn=@('S06','S10','S11'); Outcome='Olympus expands the Phase 0 shell into the full MVP dashboard shell, not just live agent cards.';
    LaneAText='Implement status, spend/quota, uptime, queue depth, auto toggle, and settings access.';
    LaneBText='Implement agent cards, SSE client state, direct command bar, response area, and kill action.';
    Auto='npm run test -- olympus/src/components/__tests__/app.test.tsx olympus/src/lib/__tests__/use-sse.test.ts; npm run build:olympus';
    Manual='The dashboard shows status, active agents, spend/quota, uptime, queue depth, auto toggle, settings access, and a working command bar and kill action on first run.'
  }
  [pscustomobject]@{
    Key='S13'; Name='Merge Queue Admission and Persistence'; Phase='phase15'; Priority='1'; Epic='aegis-fjm.14'; Contract='aegis-fjm.14.1'; LaneA='aegis-fjm.14.2'; LaneB='aegis-fjm.14.3'; Gate='aegis-fjm.14.4';
    DependsOn=@('S09','S10'); Outcome='Implemented Titan candidates are admitted to a restart-safe merge queue instead of merging directly.';
    LaneAText='Implement queue persistence and restart-safe reads and writes plus worker skeleton.';
    LaneBText='Implement candidate admission and queue visibility through events or Olympus state.';
    Auto='npm run test -- tests/unit/merge/merge-queue-store.test.ts tests/integration/merge/queue-admission.test.ts';
    Manual='Successful Titan output enters the queue instead of merging directly, and queued state survives restart before merge execution continues.'
  }
  [pscustomobject]@{
    Key='S14'; Name='Mechanical Merge Execution and Outcome Artifacts'; Phase='phase15'; Priority='1'; Epic='aegis-fjm.15'; Contract='aegis-fjm.15.1'; LaneA='aegis-fjm.15.2'; LaneB='aegis-fjm.15.3'; Gate='aegis-fjm.15.4';
    DependsOn=@('S13','S09A'); Outcome='The merge worker runs gates, lands clean candidates, emits failure artifacts, preserves labor, and triggers post-merge review.';
    LaneAText='Implement the clean merge path and mechanical gate runner.';
    LaneBText='Implement preserved labor, artifact serialization, and post-merge Sentinel trigger wiring against the contract-seeded merge outcome model.';
    Auto='npm run test -- tests/unit/merge/run-gates.test.ts tests/integration/merge/merge-outcomes.test.ts';
    Manual='A clean candidate lands, a failing candidate emits `MERGE_FAILED`, a conflicting candidate emits `REWORK_REQUEST` with preserved labor, and restart during merge processing remains safe.'
  }
  [pscustomobject]@{
    Key='S15A'; Name='Scope Allocator'; Phase='phase15'; Priority='1'; Epic='aegis-fjm.16'; Contract='aegis-fjm.16.1'; LaneA='aegis-fjm.16.2'; LaneB='aegis-fjm.16.3'; Gate='aegis-fjm.16.4';
    DependsOn=@('S04','S07','S08'); Outcome='Unsafe parallel Titan work is suppressed before dispatch.';
    LaneAText='Implement overlap detection from Oracle assessment and in-flight assignments.';
    LaneBText='Implement suppression visibility and operator-facing deferral reasons.';
    Auto='npm run test -- tests/unit/core/scope-allocator.test.ts tests/integration/core/scope-allocation.test.ts';
    Manual='Overlapping ready issues are suppressed before Titan dispatch and surfaced clearly to the operator.'
  }
  [pscustomobject]@{
    Key='S15B'; Name='Janus Escalation Path'; Phase='phase15'; Priority='2'; Epic='aegis-fjm.19'; Contract='aegis-fjm.19.1'; LaneA='aegis-fjm.19.2'; LaneB='aegis-fjm.19.3'; Gate='aegis-fjm.19.4';
    DependsOn=@('S14'); Outcome='Tier 3 integration cases can escalate to Janus safely without becoming the happy path.';
    LaneAText='Implement Janus dispatch, result parsing, and resolving_integration transitions.';
    LaneBText='Implement safe requeue behavior and human-decision artifact generation for semantic ambiguity.';
    Auto='npm run test -- tests/unit/castes/janus/janus-parser.test.ts tests/integration/merge/janus-escalation.test.ts';
    Manual='One Tier 3 integration case requeues safely after Janus success, and one semantic-ambiguity case emits a human-decision artifact instead of unsafe auto-resolution.'
  }
  [pscustomobject]@{
    Key='S16A'; Name='Benchmark Scenario Wiring'; Phase='phase15'; Priority='1'; Epic='aegis-fjm.17'; Contract='aegis-fjm.17.1'; LaneA='aegis-fjm.17.2'; LaneB='aegis-fjm.17.3'; Gate='aegis-fjm.17.4';
    DependsOn=@('S03','S11','S12','S14','S15A','S15B'); Outcome='The designated MVP scenario set is wired to the real orchestration pipeline.';
    LaneAText='Wire clean-issue, complex-pause, decomposition, clarification, and restart-during-implementation scenarios to the live pipeline.';
    LaneBText='Wire stale-branch rework, hard merge conflict, Janus escalation, Janus human-decision, restart-during-merge, and polling-only scenarios to the live pipeline.';
    Auto='npm run test -- tests/integration/evals/mvp-scenario-wiring.test.ts';
    Manual='The designated MVP scenario set covers clean-issue, complex-pause, decomposition, clarification, stale-branch rework, hard merge conflict, Janus escalation, Janus human-decision, restart-during-implementation, restart-during-merge, and polling-only cases end to end against the real orchestration pipeline.'
  }
  [pscustomobject]@{
    Key='S16B'; Name='Release Metrics and Evidence Gate'; Phase='phase15'; Priority='1'; Epic='aegis-fjm.20'; Contract='aegis-fjm.20.1'; LaneA='aegis-fjm.20.2'; LaneB='aegis-fjm.20.3'; Gate='aegis-fjm.20.4';
    DependsOn=@('S02','S16A'); Outcome='MVP metrics, thresholds, and evidence reporting are computed and enforced.';
    LaneAText='Implement metric computation and score summary generation.';
    LaneBText='Implement release-threshold evaluation and evidence report generation.';
    Auto='npm run test -- tests/unit/evals/compute-metrics.test.ts tests/integration/evals/release-gate.test.ts';
    Manual='The release report shows pass or fail against the PRD thresholds and links to the scenario artifacts that justify the decision.'
  }
)

$sliceByKey = @{}
foreach ($slice in $slices) {
  $sliceByKey[$slice.Key] = $slice
}

foreach ($slice in $slices) {
  $epicDescription = @"
Goal: $($slice.Outcome)

Parallel structure:
- contract seed
- lane A: $($slice.LaneAText)
- lane B: $($slice.LaneBText)
- verification/manual gate

Automated gate:
$($slice.Auto)

Manual gate:
$($slice.Manual)
"@

  $epicStatus = if ($existingIssueStatusById[$slice.Epic] -eq 'closed') { 'closed' } else { 'blocked' }
  Update-Issue -Id $slice.Epic -Title "[$($slice.Key)] $($slice.Name)" -Description $epicDescription -Acceptance $slice.Manual -Priority $slice.Priority -Labels @('mvp', $slice.Phase, 'planning', 'program', 'slice', $slice.Key.ToLower()) -Status $epicStatus
  Update-Issue -Id $slice.Contract -Title "[$($slice.Key)] Contract seed" -Description "Establish the contracts, scaffolding, and fixtures for $($slice.Key) so the implementation lanes can proceed independently." -Priority $slice.Priority -Labels @('child', 'contract', 'mvp', $slice.Phase, 'planning', 'program', 'slice', $slice.Key.ToLower())
  Update-Issue -Id $slice.LaneA -Title "[$($slice.Key)] Parallel lane A" -Description $slice.LaneAText -Priority $slice.Priority -Labels @('child', 'lane-a', 'mvp', $slice.Phase, 'planning', 'program', 'slice', $slice.Key.ToLower())
  Update-Issue -Id $slice.LaneB -Title "[$($slice.Key)] Parallel lane B" -Description $slice.LaneBText -Priority $slice.Priority -Labels @('child', 'lane-b', 'mvp', $slice.Phase, 'planning', 'program', 'slice', $slice.Key.ToLower())
  Update-Issue -Id $slice.Gate -Title "[$($slice.Key)] Verification and manual gate" -Description "Run the automated gate: $($slice.Auto) Then execute and record the manual gate: $($slice.Manual)" -Priority $slice.Priority -Labels @('child', 'gate', 'mvp', $slice.Phase, 'planning', 'program', 'slice', $slice.Key.ToLower())

  Ensure-Dependency -Blocked $slice.LaneA -Blocker $slice.Contract
  Ensure-Dependency -Blocked $slice.LaneB -Blocker $slice.Contract
  Ensure-Dependency -Blocked $slice.Gate -Blocker $slice.LaneA
  Ensure-Dependency -Blocked $slice.Gate -Blocker $slice.LaneB

  $desiredEpicBlockers = @()
  foreach ($depKey in $slice.DependsOn) {
    $desiredEpicBlockers += $sliceByKey[$depKey].Epic
  }
  Set-Blockers -Blocked $slice.Epic -Desired $desiredEpicBlockers
}

$programBlockers = @()
foreach ($slice in $slices) {
  $programBlockers += $slice.Epic
}
Set-Blockers -Blocked $programId -Desired $programBlockers
Run-Bd -Args @('update', $programId, '--status', 'blocked', '--set-labels', 'mvp,planning,program') | Out-Null

$tracker = [ordered]@{
  generated_at = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
  source_spec = 'SPECv2.md'
  design_doc = 'docs/superpowers/specs/2026-04-03-aegis-mvp-slicing-design.md'
  plan_doc = 'docs/superpowers/plans/2026-04-03-aegis-mvp-slice-plan.md'
  program = [ordered]@{
    id = $programId
    title = 'Aegis zero-to-MVP canonical MVP program'
  }
  slices = @()
}

foreach ($slice in $slices) {
  $evidence = if ($existingEvidenceBySlice.ContainsKey($slice.Key)) {
    $existingEvidenceBySlice[$slice.Key]
  } else {
    [ordered]@{
      automated = 'pending'
      manual = 'pending'
      notes = ''
      updated_at = ''
    }
  }

  $tracker.slices += [ordered]@{
    key = $slice.Key
    name = $slice.Name
    phase = $slice.Phase
    priority = $slice.Priority
    epic_id = $slice.Epic
    depends_on = $slice.DependsOn
    outcome = $slice.Outcome
    automated_gate = $slice.Auto
    manual_gate = $slice.Manual
    evidence_automated = $evidence.automated
    evidence_manual = $evidence.manual
    evidence_notes = $evidence.notes
    evidence_updated_at = $evidence.updated_at
    children = [ordered]@{
      contract = $slice.Contract
      lane_a = $slice.LaneA
      lane_b = $slice.LaneB
      gate = $slice.Gate
    }
  }
}

$tracker | ConvertTo-Json -Depth 8 | Set-Content -Path $trackerDataPath

$issues = Read-BdJson -Args @('list', '--json', '--status', 'all', '--limit', '400')
$issueMap = @{}
foreach ($issue in $issues) {
  $issueMap[$issue.id] = $issue
}

$epicStatusList = Read-BdJson -Args @('epic', 'status', $programId, '--json')
$epicStatusMap = @{}
foreach ($entry in $epicStatusList) {
  $epicStatusMap[$entry.epic.id] = $entry
}

$lines = @()
$lines += '# Aegis MVP Tracker'
$lines += ''
$lines += "- Refreshed: $((Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK'))"
$lines += '- Source spec: SPECv2.md'
$lines += '- Design doc: docs/superpowers/specs/2026-04-03-aegis-mvp-slicing-design.md'
$lines += '- Plan doc: docs/superpowers/plans/2026-04-03-aegis-mvp-slice-plan.md'
$lines += "- Program epic: $programId"
$lines += "- Program status: $($issueMap[$programId].status)"
$lines += "- Program updated: $($issueMap[$programId].updated_at)"
$lines += '- Operational queue: use `bd ready`; slice and program epics stay `blocked` as coordination units because Beads cannot model task-to-epic blockers.'
$lines += '- Planning view: `bd swarm validate` still reports epic-level waves and is advisory, not the executable queue.'
$lines += ''
$lines += '## Slice Epics'
$lines += ''

foreach ($slice in $tracker.slices) {
  $epic = $issueMap[$slice.epic_id]
  $status = $epicStatusMap[$slice.epic_id]
  $dependsText = if ($slice.depends_on.Count -gt 0) { ($slice.depends_on -join ', ') } else { 'none' }
  $lines += "### $($slice.key) - $($slice.name) ($($slice.epic_id))"
  $lines += ''
  $lines += "- Status: $($epic.status)"
  $lines += "- Updated: $($epic.updated_at)"
  if ($status) {
    $lines += "- Child completion: $($status.closed_children)/$($status.total_children)"
  }
  $lines += "- Depends on: $dependsText"
  $lines += "- Outcome: $($slice.outcome)"
  $lines += "- Automated gate: $($slice.automated_gate)"
  $lines += "- Manual gate: $($slice.manual_gate)"
  $lines += "- Automated evidence: $($slice.evidence_automated)"
  $lines += "- Manual evidence: $($slice.evidence_manual)"
  if ($slice.evidence_notes) {
    $lines += "- Evidence notes: $($slice.evidence_notes)"
  }
  if ($slice.evidence_updated_at) {
    $lines += "- Evidence updated: $($slice.evidence_updated_at)"
  }
  $lines += '- Children:'
  foreach ($child in @(
    @{ name = 'contract'; id = $slice.children.contract },
    @{ name = 'lane_a'; id = $slice.children.lane_a },
    @{ name = 'lane_b'; id = $slice.children.lane_b },
    @{ name = 'gate'; id = $slice.children.gate }
  )) {
    $issue = $issueMap[$child.id]
    $lines += "  - $($child.name): $($child.id) [$($issue.status)] updated $($issue.updated_at)"
  }
  $lines += ''
}

$lines -join [Environment]::NewLine | Set-Content -Path $trackerMarkdownPath

Write-Output "UPDATED=$programId"
