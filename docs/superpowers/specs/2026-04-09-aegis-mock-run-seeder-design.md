# Aegis Mock Run Seeder Design

## Purpose

Add a tracked, deterministic seeding command that recreates a disposable mock repository named `aegis-mock-run` for black-box Aegis runs.

The generated repository must let an operator exercise real `aegis` and `bd` commands against a stable workload instead of relying on the internal eval harness alone.

## Source of truth

- Product behavior: `SPECv2.md`
- Repo operating rules: `AGENTS.md`
- Existing execution guidance: `docs/superpowers/aegis-execution-workflow.md`
- Follow-up issue: `aegis-odz`

## Goals

- Recreate the same disposable mock repo from scratch on every run
- Keep the seeding logic tracked in this repo while keeping the generated mock repo untracked
- Seed a deterministic Beads issue graph that proves dependency ordering and lane parallelism
- Configure the generated repo for Pi runs using Gemma 4 defaults
- Emit a stable machine-readable map from logical issue keys to actual Beads IDs
- Verify that the initial ready queue matches the intended workflow

## Non-goals

- Replacing the existing eval harness
- Building a generic project templating system
- Implementing new orchestration behavior inside Aegis itself
- Generating multiple mock project types in the first version
- Hiding tracker setup behind informal text files or manual instructions

## User-facing shape

The feature adds one tracked command:

- `npm run mock:seed`

Default behavior:

1. Delete `[repo root]/aegis-mock-run` if it exists
2. Recreate the directory from scratch
3. Write a baseline todo-system project into it
4. Run `git init`
5. Run `bd init`
6. Run `aegis init`
7. Apply deterministic config overrides for the mock run
8. Seed the canonical Beads issue graph
9. Validate the ready queue
10. Write a run manifest with logical issue keys and actual Beads IDs

The command is deterministic by default. Internal helpers may accept an explicit target path for tests, but the user-facing path remains `aegis-mock-run`.

## Generated repository

The generated repo lives at:

- `aegis-mock-run/`

The tracked repo must ignore it via root `.gitignore`.

The generated repo itself is disposable and must not be added to source control. The seeder is free to destroy local edits there because reset-by-recreation is the explicit contract.

## Baseline todo project

The mock repo contains a small Node and TypeScript todo system with enough surface area to support multiple issue waves and mostly disjoint file ownership.

Planned baseline files:

- `package.json`
- `tsconfig.json`
- `README.md`
- `src/models/task.ts`
- `src/store/task-store.ts`
- `src/commands/create-task.ts`
- `src/commands/list-tasks.ts`
- `src/commands/complete-task.ts`
- `src/cli.ts`
- `src/reporting/summary.ts`
- `tests/`

The seeded code should be intentionally simple but real enough that future Aegis runs can modify it in plausible ways.

## Gemma 4 defaults

The mock repo must be prepared for Pi-driven runs using Gemma 4 defaults.

The seeder writes:

- `.pi/settings.json` with `google` as the default provider and `gemma-4-31b-it` as the default model
- `.aegis/config.json` model overrides that prefer Pi Gemma 4 for the castes used in black-box runs

This does not fix the existing runtime model-propagation bug by itself. The point is to make the mock repo consistent and future-proof once Aegis honors per-caste model mapping.

## Issue graph design

The seeded workload is one todo-system program split into sequential slices with parallel lanes.

### Program structure

- one program epic: `todo-system`
- three slice epics:
  - `foundation`
  - `commands`
  - `integration`

The program epic and slice epics are created as coordination units and must be kept out of the executable queue. The seeder should place them in a non-ready state so `bd ready --json` only exposes executable child work.

Each slice follows the same internal shape:

- `contract`
- `lane_a`
- `lane_b`
- `gate`

### Dependency rules

Within a slice:

- `lane_a` depends on `contract`
- `lane_b` depends on `contract`
- `gate` depends on `lane_a`
- `gate` depends on `lane_b`

Across slices:

- `commands.contract` depends on `foundation.gate`
- `integration.contract` depends on `commands.gate`

Parent-child links are also created so the program epic and slice epics remain coordination units rather than queue truth.

The intended queue behavior is:

1. `foundation.contract` is the only ready issue after seeding
2. closing `foundation.contract` makes both foundation lanes ready in parallel
3. closing both foundation lanes makes `foundation.gate` ready
4. closing `foundation.gate` makes `commands.contract` ready
5. the same pattern repeats for the later slices

## Seeded issue content

The seeded issues are specific enough to drive useful edits instead of generic placeholders.

### Foundation slice

- `foundation.contract`
  - lock the todo model, storage interface, and test contracts
- `foundation.lane_a`
  - implement task model and in-memory store behavior
  - primary file ownership: `src/models/task.ts`, `src/store/task-store.ts`
- `foundation.lane_b`
  - implement shared validation and fixture setup
  - primary file ownership: `tests/`, support utilities
- `foundation.gate`
  - prove the foundation contract and baseline tests

### Commands slice

- `commands.contract`
  - define command behavior for create, list, and complete flows
- `commands.lane_a`
  - implement create and list commands
  - primary file ownership: `src/commands/create-task.ts`, `src/commands/list-tasks.ts`
- `commands.lane_b`
  - implement completion flow and command tests
  - primary file ownership: `src/commands/complete-task.ts`, command-focused tests
- `commands.gate`
  - prove command behavior and close the slice

### Integration slice

- `integration.contract`
  - lock CLI integration, summary output, and end-to-end behavior
- `integration.lane_a`
  - implement CLI wiring
  - primary file ownership: `src/cli.ts`
- `integration.lane_b`
  - implement reporting and end-to-end verification
  - primary file ownership: `src/reporting/summary.ts`, end-to-end tests
- `integration.gate`
  - prove the integrated todo system

This layout deliberately creates both sequencing and safe-ish parallel windows while still forcing later slices to consume earlier outcomes.

## Manifest-backed seeding

The seeder should not hardcode the whole graph inline inside one procedural function.

The implementation should separate:

- baseline repo files and config content
- logical issue definitions
- dependency declarations
- seeding execution

Recommended tracked modules:

- `src/mock-run/seed-mock-run.ts`
- `src/mock-run/todo-manifest.ts`
- `src/mock-run/types.ts`

The manifest defines logical issue keys such as `foundation.contract` and `integration.lane_b`. The seeder resolves those to actual Beads IDs at runtime and persists the mapping.

## Output artifacts

The generated repo must contain a durable report of what was seeded.

Recommended output:

- `.aegis/mock-run-manifest.json`

That file should include at minimum:

- generated repo path
- generation timestamp
- logical issue key to actual Beads ID map
- initial ready queue snapshot
- seeded model settings summary

This gives operators and later tools a stable lookup layer without scraping tracker output.

## Validation contract

The seeder must fail closed if setup drift is detected.

Required checks:

- target directory was recreated successfully
- `git init` succeeded
- `bd init` succeeded
- `aegis init` succeeded
- all expected issues were created
- all expected dependency links were created
- the initial `bd ready --json` output contains exactly one issue
- that issue is `foundation.contract`

If the ready queue does not match the expected first step, the command must stop with a clear error because the seeded graph is no longer trustworthy.

## Testing strategy

Add automated coverage for the seeder itself.

Expected tests:

- creates the target repo and baseline files
- rewrites the repo from scratch on a second run
- writes Gemma 4 defaults into the generated repo
- creates the expected number of issues and mapping entries
- verifies only the first contract issue is initially ready
- proves the lane parallelism window by closing the seeded contract and confirming two ready lanes

Tests should use disposable directories and a dedicated Beads prefix so they do not interfere with the main repo tracker.

## Risks and constraints

- `bd init` behavior differs by environment, so the implementation must explicitly use the server-backed mode that works in this repo
- the seeded repo is intentionally destructive on rerun, so the command must only target the known `aegis-mock-run` directory unless an internal test path override is provided
- Aegis public commands are not fully wired yet, so the first version of this feature is primarily a reproducible environment and queue harness rather than a full green end-to-end orchestrator proof

## Expected outcome

After this lands, a developer can run one command and get the same disposable todo-system repo, the same issue graph, and the same initial ready queue every time.

That gives Aegis a real black-box smoke environment that complements the internal eval harness instead of duplicating it.
