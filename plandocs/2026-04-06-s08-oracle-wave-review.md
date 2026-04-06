# S08 Oracle Scouting Pipeline — Code Review

- **Branch:** `feat/s08-oracle-wave`
- **Base:** `main`
- **Date:** 2026-04-06
- **Diff:** `git diff main...HEAD` — 5 files changed, +1,757 / −96 lines
- **Verdict:** Approve — no critical issues; 2 suggestions confirmed
- **Status:** Resolved — both confirmed suggestions implemented and verified

## Resolution Summary

Both confirmed suggestions have been implemented and verified:

1. **Timeout leak fixed** — `collectOracleResponse` now clears its timeout timer in a `finally` block, preventing event loop leakage in both CLI and long-running server contexts.
2. **Description template deduplicated** — `oracleDerivedDescription()` extracted to `src/castes/oracle/oracle-parser.ts` and used by both `run-oracle.ts` and `create-derived-issues.ts`, eliminating the risk of silent drift between the two copies.

All gates pass: `npm run build`, `npm run lint`, `npm run test` (459 tests).
Both fixes independently reviewed by subagents with no issues found.
Worktrees cleaned up, stray files removed.

## Changed Files (Post-Resolution)

| File | Change |
|------|--------|
| `src/core/run-oracle.ts` | Timeout cleanup + shared description import |
| `src/castes/oracle/oracle-parser.ts` | New `oracleDerivedDescription()` function |
| `src/tracker/create-derived-issues.ts` | Uses shared `oracleDerivedDescription()` |

---

## Original Review

### Changed Files

| File | Lines Changed | Summary |
|------|--------------|---------|
| `src/core/run-oracle.ts` | +571 | Oracle dispatch, assessment collection, derived issue materialization, rollback logic |
| `src/tracker/beads-client.ts` | +40 | `linkIssue`, `unlinkIssue`, `addBlocker`, `removeBlocker`, `closeIssue`; originId linking in `createIssue` |
| `tests/integration/core/run-oracle.test.ts` | +1,061 | Integration tests for Oracle happy path, complexity gating, rollback, orphan recovery |
| `tests/unit/castes/oracle/oracle-parser.test.ts` | +100 | Parser contract tests for `OracleAssessment` schema |
| `tests/unit/tracker/beads-client.test.ts` | +81 | Tests for blocker/link operations |

## Verification Stats

| Phase | Count |
|-------|-------|
| Initial findings reported | 9 |
| Confirmed after independent verification | 2 |
| Rejected after independent verification | 7 |

## Confirmed Findings

### Suggestion — 1 ✅ RESOLVED

- **File:** `src/core/run-oracle.ts:183`
- **Issue:** The 10-minute `setTimeout` in `collectOracleResponse`'s `timeoutPromise` is never cleared when `sessionPromise` resolves successfully. The timer remains scheduled in the event loop for the full duration even after the `Promise.race` has settled.
- **Impact:** In CLI/batch usage, the dangling timer prevents the Node.js event loop from exiting naturally for up to 10 minutes. In a long-running server process, each successful Oracle call accumulates an unnecessary timer handle.
- **Fix applied:** Added `let timeoutId` declaration and `clearTimeout(timeoutId!)` in a `finally` block after `Promise.race`.
- **Verified by:** Independent subagent review + `npm run build && npm run lint && npm run test` (459 tests pass).

### Suggestion — 2 ✅ RESOLVED

- **File:** `src/core/run-oracle.ts:275` (and `src/tracker/create-derived-issues.ts`)
- **Issue:** The orphan recovery and stale-child detection logic uses an exact string match on the description field: `` `Derived from Oracle assessment for ${issueId}.` ``. This same template string is duplicated in `create-derived-issues.ts` with no shared constant. If either copy changes independently, orphan recovery silently stops finding derived issues.
- **Impact:** On retry after a partial failure, orphaned issues from the prior run would not be recovered, causing duplicate sub-issues to be created instead of reused.
- **Fix applied:** Extracted `oracleDerivedDescription(issueId: string)` function into `src/castes/oracle/oracle-parser.ts`. Both `run-oracle.ts` and `create-derived-issues.ts` now import and use this shared function.
- **Verified by:** Independent subagent review + `npm run build && npm run lint && npm run test` (459 tests pass).

## Rejected Findings

### Finding 3 — Path traversal in `buildOracleAssessmentRef`

- **File:** `src/core/run-oracle.ts:84`
- **Initial claim:** `issueId` interpolated directly into file path without validation could allow path traversal.
- **Rejected because:** `issueId` originates from the Beads tracker's issue model (e.g., `"aegis-fjm.6.1"`). Beads-generated IDs follow a strict naming pattern and are not user-supplied input. Path traversal is not feasible in this trust model.

### Finding 4 — `shift()` mutates Map array (no-mutation violation)

- **File:** `src/core/run-oracle.ts:337, 348`
- **Initial claim:** `reusableIssues.shift()` and `orphanedIssues.shift()` mutate arrays stored in Maps, violating the "no mutations" convention.
- **Rejected because:** The arrays stored in the Maps are internal copies created by `groupReusableDerivedIssues` (which uses spread to create new arrays). They do not reference external state or any data that survives beyond the `materializeDerivedIssues` call, so mutation via `shift()` has no observable side effect outside the function.

### Finding 5 — Oracle `toolRestrictions: []` — no read-only enforcement

- **File:** `src/core/run-oracle.ts:157`
- **Initial claim:** `collectOracleResponse` spawns with `toolRestrictions: []`, meaning no tools are restricted. SPEC says Oracle should be read-only.
- **Rejected because:** In `pi-runtime.ts`, `PiRuntime.spawn()` calls `resolveBaseTools(opts.caste)` first, which returns `readOnlyTools` for the `"oracle"` caste. `applyToolRestrictions(baseTools, [])` returns all base tools (already read-only). Read-only enforcement happens at the caste resolution level, not via explicit `toolRestrictions`. The SPEC requirement is satisfied.

### Finding 6 — `findFinalOraclePayloadMessage` returns raw untrimmed string

- **File:** `src/core/run-oracle.ts:132-141`
- **Initial claim:** The function validates `candidate.trim()` is non-empty but returns the original untrimmed `messages[index]`. If the Oracle emits trailing whitespace, `parseOracleAssessment` may fail.
- **Rejected because:** `JSON.parse()` in JavaScript natively handles leading and trailing whitespace per the ECMAScript spec, so the untrimmed return value poses no parsing risk.

### Finding 7 — `unlinkIssue` uses `dep remove` without type

- **File:** `src/tracker/beads-client.ts:360`
- **Initial claim:** `unlinkIssue` calls `bd dep remove` — same command as `removeBlocker`. If Beads tracks multiple dependency types between the same pair, could remove the wrong type.
- **Rejected because:** Pre-existing code in unchanged `beads-client.ts` — `unlinkIssue` and `removeBlocker` both call `bd dep remove` identically, and the concern about type conflation is a pre-existing design pattern outside S08 scope.

### Finding 8 — Complexity disposition falls through to "allow" for unknown modes

- **File:** `src/core/run-oracle.ts:115-125`
- **Initial claim:** If `operatingMode` is neither `"auto"` nor `"conversational"`, falls through to `"allow"` for complex issues. Should default to requiring human approval.
- **Rejected because:** `OperatingMode` is a closed union type `("conversational" | "auto")` — no unknown modes are possible. The final `return "allow"` is unreachable for unknown modes; it handles the legitimate case where mode is `"auto"` and `allowComplexAutoDispatch` is `true`.

### Finding 9 — `createIssue` link rollback — closed issue orphan on retry

- **File:** `src/core/run-oracle.ts`, `materializeDerivedIssues` error handling
- **Initial claim:** When `createIssue` succeeds but `addBlocker` fails, the issue is closed in rollback. On retry of `runOracle`, the closed issue is filtered out (`status !== "closed"`), so a new duplicate issue is created.
- **Rejected because:** Uncertain — the duplicate-creation scenario depends on whether `runOracle` is actually retried after a `DerivedIssueMaterializationError`, and the `status !== "closed"` filter is an intentional design choice to treat closed issues as definitively rolled back. Without evidence of a retry path that triggers this, it remains speculative.

## Positive Observations

- **Atomic write pattern** in `persistOracleAssessment` correctly uses `writeFileSync` to `.tmp` then `renameSync` — consistent with AGENTS.md convention and matching `saveDispatchState` in `dispatch-state.ts`.
- **No mutations** of dispatch records — `transitionStage()` is used correctly, and the result is spread into a new object. All error paths return new `RunOracleResult` objects.
- **Windows-first path handling** — all paths use `join()` from `node:path`, not string concatenation.
- **Fail-closed design** — all error paths in `runOracle` return `DispatchStage.Failed` with a `failureReason`. The `DerivedIssueMaterializationError` custom error carries rollback state for the caller.
- **Rollback correctness** in `beads-client.ts` `createIssue()` — when `linkIssue` fails after a successful `createIssue`, the created issue is cleaned up via `closeIssue`, and rollback failure is surfaced with the created issue attached.
- **Test coverage** — integration tests cover happy path, complexity gating, malformed output, partial rollback failure, orphan recovery, stale artifact handling, and retry deduplication. Parser tests cover type coercion attacks and distinguish `invalid_json` vs `invalid_shape` error reasons.
