# MVP Release Checklist

This checklist is the static operator companion for the S16B release gate.
It mirrors the release thresholds from `SPECv2.md` section 24.8 and points the
gate logic at the canonical benchmark manifest in `evals/scenarios/mvp-gate.json`.

## Required Inputs

- The full MVP scenario manifest from `evals/scenarios/mvp-gate.json`
- One eval result artifact per scenario under `.aegis/evals/<scenario-id>/`
- One score summary artifact per scenario once lane A lands
- A generated release report that references the evidence catalog below

## Release Checks

| Check ID | Requirement | Threshold | Evidence scope |
| --- | --- | --- | --- |
| `structured_artifact_compliance_100pct` | Structured artifacts are compliant across the MVP suite | `structured_artifact_compliance_rate >= 1.0` | All scenarios in `evals/scenarios/mvp-gate.json` |
| `clarification_compliance_100pct` | Intentionally ambiguous scenarios raise clarifications correctly | `clarification_compliance_rate >= 1.0` | `clarification` |
| `restart_recovery_100pct` | Restart recovery succeeds on all designated scenarios | `restart_recovery_success_rate >= 1.0` | `restart-during-implementation`, `restart-during-merge` |
| `no_direct_to_main_bypasses` | No scenario bypasses the merge queue and lands directly on main | `direct_to_main_bypass_count <= 0` | All merge-bearing MVP scenarios |
| `issue_completion_rate_80pct` | Suite-wide issue completion rate clears the PRD floor | `issue_completion_rate >= 0.8` | All scenarios in `evals/scenarios/mvp-gate.json` |
| `human_interventions_within_threshold` | Human interventions stay within the PRD operating budget | `human_interventions_per_10_issues <= 2` | All scenarios in `evals/scenarios/mvp-gate.json` |
| `janus_minority_path` | Janus remains the minority path through the system | `janus_invocation_rate_per_10_issues <= 5` | `janus-escalation`, `janus-human-decision` |

## Evidence Notes

- The release report must show pass or fail for every check above.
- Each check must link back to the scenario artifacts that justify the decision.
- Lane A owns metric computation and score summary generation.
- Lane B owns threshold evaluation and release report generation.
