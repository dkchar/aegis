# Configuration

`aegis init` writes `.aegis/config.json`. Every key is optional; missing keys take the defaults below. Unknown keys and invalid values are rejected when the config loads, and Olympus validates edits with the same rules before saving.

```json
{
  "runtime": "scripted",
  "models": {
    "oracle": "openai-codex:gpt-5.4-mini",
    "titan": "openai-codex:gpt-5.4-mini",
    "sentinel": "openai-codex:gpt-5.4-mini",
    "janus": "openai-codex:gpt-5.4-mini"
  },
  "thinking": { "oracle": "medium", "titan": "medium", "sentinel": "medium", "janus": "medium" },
  "concurrency": { "max_agents": 3, "max_oracles": 1, "max_titans": 1, "max_sentinels": 1, "max_janus": 1 },
  "thresholds": {
    "poll_interval_seconds": 5,
    "stuck_warning_seconds": 90,
    "stuck_kill_seconds": 150,
    "allow_complex_auto_dispatch": false,
    "scope_overlap_threshold": 0,
    "janus_retry_threshold": 2
  },
  "janus": { "enabled": true, "max_invocations_per_issue": 1 },
  "labor": { "base_path": ".aegis/labors" },
  "git": { "base_branch": "main" }
}
```

| Key | Meaning |
| --- | --- |
| `runtime` | `claude`, `codex`, `pi`, or `scripted`. See [runtime adapters](runtime-adapters.md). |
| `models.<caste>` | `<provider>:<model-id>`. Claude uses `anthropic:claude-opus-5-5` style refs; Pi refs must match an authenticated provider. |
| `thinking.<caste>` | `off`, `low`, `medium`, `high`. Passed to Codex as reasoning effort and to Pi as thinking level; recorded for Claude. |
| `concurrency.max_agents` | Total concurrent sessions (minimum 1). |
| `concurrency.max_<caste>s` | Per-caste session caps (minimum 1). |
| `thresholds.poll_interval_seconds` | Daemon cycle interval. |
| `thresholds.stuck_warning_seconds` | Session age that logs a warning. |
| `thresholds.stuck_kill_seconds` | Session age that terminates the session. |
| `thresholds.allow_complex_auto_dispatch` | When true, Sentinel `create_blocker` findings create policy blocker tickets; when false they rework the owner. |
| `thresholds.scope_overlap_threshold` | Shared files tolerated between Titans running in parallel (0 means none). |
| `thresholds.janus_retry_threshold` | Merge retries before Janus is invoked. |
| `janus.enabled` | Whether merge conflicts escalate to Janus or fail. |
| `janus.max_invocations_per_issue` | Janus invocations per merge queue item. |
| `labor.base_path` | Where labor worktrees are created (relative to the project or absolute). |
| `git.base_branch` | Branch candidates merge into. |

## Retry Policy

- Operational failures (runtime errors, invalid artifacts, Titan `failure` outcomes, failed merges) increment `consecutiveFailures` and apply a 30 second cooldown.
- After 3 consecutive failures, triage skips the issue with `operational_failure_limit`, and `aegis status` lists it under `terminal_operational_failures`.
- Provider usage-limit errors exhaust retries immediately, and the daemon stops in `paused` mode instead of consuming more quota.
- A failed Sentinel review retries once at the review layer, then escalates to Titan with the existing Oracle context.

## Files Under `.aegis/`

| Path | Contents |
| --- | --- |
| `config.json` | this configuration |
| `dispatch-state.json` | orchestration truth per issue |
| `merge-queue.json` | merge candidates and outcomes |
| `runtime-state.json` | daemon pid, state, mode |
| `runtime-commands/` | request/response files for direct commands routed to the daemon |
| `labors/` | git worktrees, one per issue |
| `oracle/`, `titan/`, `sentinel/`, `janus/` | caste artifacts and git proof |
| `policy/` | mutation policy decisions |
| `transcripts/` | full session transcripts |
| `logs/daemon.log` | daemon lifecycle and cycle errors |
| `logs/phases/` | one JSON file per loop event (`<timestamp>-<phase>-<issue>.json`) |
| `logs/sessions/` | session status reports |
