# Completed Slices Cleanup Pass Design

## Purpose

Run a cleanliness and code-quality pass over the work that is already recorded as complete, while preserving the shipped contract defined by `SPECv2.md`.

This pass is not a new feature slice. It is a structural refinement pass over closed work only.

## Source of truth

- Product truth: `SPECv2.md`
- Completion truth: Beads closed slices and child issues
- Tracker mirror: `plandocs/2026-04-03-aegis-mvp-tracker.md`

The markdown tracker is a mirror, not an authority. It is used only to confirm which slices are closed and what gate evidence was recorded.

## In-scope slices

Only the following closed work is in scope:

- `S00` Project Skeleton and Toolchain
- `S01` Config and Filesystem Contracts
- `S02` Eval Harness Foundation
- `S03` Fixture Repos and Benchmark Corpus
- `S04` Tracker Adapter and Dispatch Store
- `S05` Runtime Contract and Pi Adapter
- `S06` HTTP Server, SSE Bus, and Launch Lifecycle
- `aegis-fjm.21` S06 lifecycle remediation

## Out of scope

The pass must not pull in work owned by future slices, especially:

- `S07` direct commands and operating modes
- `S08` Oracle pipeline
- `S09` Titan and labors
- `S09A` Sentinel pipeline
- `S10` monitor, reaper, cooldown, recovery
- `S11` Mnemosyne and Lethe behavior beyond current storage seams
- `S12+` full Olympus, merge queue, Janus, benchmarks, and release gate work

This pass also does not change the MVP boundary, issue plan, or tracker structure.

## Goals

- Remove structural duplication that no longer provides useful separation
- Tighten module boundaries where completed slices left temporary split-by-lane residue
- Reduce stale contract-seed commentary that now obscures implemented behavior
- Simplify tests where multiple files prove the same closed-slice invariant at different signal levels
- Keep or improve clarity around the truth boundaries required by the spec:
  - tracker truth
  - dispatch-state truth
  - runtime boundary
  - HTTP and SSE visibility boundary

## Non-goals

- Adding net-new product behavior for future slices
- Reworking architecture around unfinished systems
- Changing user-facing semantics unless a completed slice clearly omitted behavior that belongs to that same completed slice
- Weakening automated or manual gate coverage

## Current assessment

The completed slices are present and verified, but the codebase still shows delivery-shape residue from the slice workflow:

- duplicate helper logic exists where a contract file and implementation file both retained the same concern
- eval validation vocabulary is repeated across multiple modules
- some comments still describe code as lane scaffolding or contract-seed work even though the implementation is live
- a few tests are clearly structural duplicates or historical stub checks rather than meaningful regression guards

These are good cleanup targets because they do not change the product contract when handled carefully.

## Refactor rules

### 1. Preserve spec-visible seams

Keep seams that match explicit product boundaries in `SPECv2.md`:

- config loading and filesystem bootstrap
- tracker client and issue model
- dispatch-state storage and stage transitions
- runtime adapter and event mapping
- HTTP routes, SSE transport, and lifecycle state

Large files alone are not enough reason to split or merge. The deciding rule is whether the seam is required by the spec or only left over from slice execution.

### 2. Merge only where the split no longer buys safety

Safe consolidation targets are pieces that were split to unblock contract and lane execution but now behave as one unit in practice. Good candidates include:

- duplicate helper implementations
- duplicated enum or validation sets
- tests that restate the same invariant through weaker constant-shape assertions

### 3. Test reduction must be evidence-based

Tests may only be combined or dropped when all of the following are true:

- the removed assertion is covered elsewhere at equal or higher behavioral strength
- the remaining tests still prove the slice acceptance criteria
- the refactor does not reduce coverage for the spec-visible contract
- verification stays green on the touched surface

### 4. No future-slice leakage

If a change starts to require unfinished concepts such as process loop semantics, merge queue behavior, labor lifecycle, or richer Olympus state, it must stop and stay out of scope.

## Planned cleanup areas

### Shared paths and bootstrap cleanup

`src/index.ts` and `src/shared/paths.ts` both own project-path resolution today. This is pure duplication and should collapse to one implementation without changing the S00 contract.

### Eval schema and validation cleanup

`src/evals/result-schema.ts`, `src/evals/fixture-schema.ts`, and `src/evals/validate-result.ts` repeat canonical outcome vocabulary and validation helpers. This is a good consolidation target because the vocabulary is already fixed by S02 and S03.

The intended end state is one canonical source for outcome sets and shared validation primitives, with fixture and result validation consuming it.

### Test cleanup

Likely safe candidates:

- vacuous "stub no longer throws" tests
- duplicate constant-shape assertions that are weaker than higher-level behavior tests
- isolated test files that can be merged into the stronger suite that already owns the behavior

Likely keep:

- config load and init behavior tests
- dispatch-state persistence and reconciliation tests
- Pi runtime event mapping and budget tests
- HTTP route, SSE replay, ownership, and graceful shutdown tests
- CLI start, status, and stop integration tests

### Comment and naming cleanup

Completed modules should stop describing themselves as future lane work or scaffolding where that wording is now misleading. This is in scope when it improves readability without changing behavior.

## S06 omission rule

This pass is primarily structural. A behavior change is allowed only if all of the following are true:

- the omitted behavior is clearly part of `S06` or its remediation, not a future slice
- the requirement is explicit in `SPECv2.md`
- the implementation can be added locally without inventing future orchestration behavior
- verification can prove the completed-slice contract is improved rather than broadened

If a possible S06 gap requires future-slice semantics, it must be left alone.

Examples of likely defer cases:

- anything needing `S07` direct command semantics
- anything needing `S10` monitor or cooldown logic
- anything needing `S12` fuller Olympus state
- any override flag whose real meaning depends on unfinished orchestration paths

## Verification strategy

For touched areas, run the smallest commands that still prove the closed-slice contract:

- targeted Vitest files for the affected slice
- broader `npm test` before completion
- `npm run build`

Diff review must explicitly check that:

- no completed-slice acceptance criterion is weakened
- no source-of-truth boundary is blurred
- no test removal leaves a contract unproved

## Expected outcome

After this pass:

- the closed-slice code should be easier to read and maintain
- duplicate definitions should be reduced
- tests should be higher-signal and less obviously historical
- behavior for `S00` through `S06` should remain intact, except for any narrowly justified S06 omission fix that clearly belongs to already-completed work
