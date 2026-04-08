# S16B Review Remediation Handoff

- Date: 2026-04-08
- Branch: `feat/s16b-release-metrics`
- Ready Beads issue: `aegis-75i`
- Current umbrella branch tip: `1125fd3` (`docs: record s16b remediation handoff`)
- Last clean implementation commit to resume from: `3673d77` (`chore: refresh tracker parity and stabilize slow tests`)
- Main worktree status after cleanup: clean; accidental local `olympus/` deletions on `main` were restored and are not pending work

## Why S16B Was Not Accepted

Three independent review agents reached consensus that the first S16B pass should not be treated as accepted even though the Beads slice and its gate child were already closed.

Blocking findings:

- `issue_evidence` is still synthetic or points at transient sandbox files instead of durable eval-root artifacts from the live runs.
- Clarification compliance currently misses the denominator for scenarios that should have clarified but did not.
- Restart recovery is effectively hardcoded to success for designated restart scenarios.
- `validateEvalRunResult()` does not enforce parity between `issue_count`, `completion_outcomes`, `merge_outcomes`, and `issue_evidence`.
- Janus "minority path" should fail at exactly 5 per 10 issues, not pass.
- There is no checked-in end-to-end release report generator that discovers persisted suite results, writes score summaries, and emits a report artifact under `.aegis/evals/reports/`.

## Red Tests Added Before Wrap-Up

These tests were added locally to drive the remediation and were intentionally left uncommitted when the session was wrapped:

- `tests/unit/evals/result-schema.test.ts`
- `tests/integration/evals/run-scenario.test.ts`
- `tests/integration/evals/release-gate.test.ts`

Focused red command:

```powershell
npm run test -- tests/unit/evals/result-schema.test.ts tests/integration/evals/run-scenario.test.ts tests/integration/evals/release-gate.test.ts
```

Expected failures from that command:

- Janus exact-boundary check should fail at 5/10.
- Clarification denominator should include missed clarifications.
- Restart recovery should fail when a designated restart scenario does not recover.
- Result validation should reject missing `issue_evidence` entries.
- Live scenario evidence refs should point to durable artifacts under the eval root.
- `generateReleaseGateReportFromDisk()` does not exist yet.

## Partial WIP That Was Deliberately Dropped

An unverified remediation attempt existed only in the working tree and was not left in place for handoff. The attempted files were:

- `src/evals/compute-score-summary.ts`
- `src/evals/mvp-scenario-runners/lane-a.ts`
- `src/evals/mvp-scenario-runners/shared.ts`
- `src/evals/release-gate.ts`
- `src/evals/result-schema.ts`
- `src/evals/validate-result.ts`
- `src/evals/write-result.ts`
- `tests/integration/evals/release-gate.test.ts`
- `tests/integration/evals/run-scenario.test.ts`
- `tests/unit/evals/result-schema.test.ts`

One important warning from that aborted attempt: `src/evals/mvp-scenario-runners/lane-b.ts` still needs a fresh inspection before implementing anything because a patch attempt there failed partway through and was never completed in the abandoned local WIP.

## Recommended Restart Point

1. Start from `aegis-75i` in `bd ready --json`.
2. Re-add the red tests above.
3. Implement durable evidence capture for both lane A and lane B scenario runners.
4. Add parity validation and fail-closed metric behavior.
5. Land a checked-in disk-discovery release report generator.
6. Re-run focused tests, then `npm run test`, `npm run lint`, and `npm run build`.
7. Re-run 3 independent review agents and require consensus before treating S16B as accepted.
