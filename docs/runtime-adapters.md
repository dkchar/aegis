# Runtime Adapters

`docs/AEGIS.md` is the canonical source of truth. This page documents how each adapter implements the adapter contract.

## Contract

Aegis owns the contract; adapters are replaceable. Two interfaces exist in `src/runtime/`:

- `CasteRuntime.run(input)` (`caste-runtime.ts`): one caste session to completion. Returns a `CasteSessionResult` with status, final output text, tools used, message log, and optionally a terminal log and usage.
- `AgentRuntime` (`agent-runtime.ts`): the daemon view. `launch` returns a session id immediately and runs the caste command in the background; `readSession` returns the durable session report under `.aegis/logs/sessions/`; `terminate` aborts it. `dispatch-runtime.ts` implements this once for every adapter.

Whatever the adapter reports, Aegis validates afterwards:

- artifacts are parsed against strict schemas (`src/castes/*/`)
- Titan git proof: the candidate branch advanced, changed files stay in scope, the project root stayed clean
- operational failures are classified (provider usage limits exhaust retries immediately) and counted toward the retry ceiling
- transcripts are persisted for success and failure

Adapter names, and whether an adapter hands artifacts back through tools or JSON text, live in one place: `src/runtime/runtime-registry.ts`.

## Claude Code (`claude`)

Implementation: `src/runtime/claude-caste-runtime.ts`.

Each caste session runs:

```text
claude -p --output-format stream-json --verbose \
  --model <model-id> --permission-mode default \
  --allowedTools <caste allow list> --disallowedTools <caste deny list> \
  --strict-mcp-config --append-system-prompt <Aegis guard> [--max-turns N] [extra args]
```

The prompt is sent on stdin and the working directory is the caste's workspace (project root for Oracle and Janus, the labor worktree for Titan, the candidate worktree for Sentinel).

Tool policy per caste:

| Caste | Allowed | Denied |
| --- | --- | --- |
| Oracle | Read, Grep, Glob, LS | Edit, MultiEdit, Write, NotebookEdit, Bash, WebFetch, WebSearch, Task |
| Titan | Read, Grep, Glob, LS, Edit, MultiEdit, Write, Bash | NotebookEdit, WebFetch, WebSearch, Task |
| Sentinel | Read, Grep, Glob, LS, Bash | edit tools, WebFetch, WebSearch, Task |
| Janus | Read, Grep, Glob, LS, read-only git (`status`, `diff`, `log`, `show`, `merge-base`) | edit tools, WebFetch, WebSearch, Task |

Headless sessions cannot prompt for approval, so anything outside the allow list is refused.

The `stream-json` events are folded into the transcript: assistant text becomes the message log, tool calls and tool errors become the terminal log, and the final `result` event supplies the artifact text plus usage (tokens, cost, turns, duration). A session fails when the result is an error, the turn limit is hit, the CLI exits non-zero, or no result arrives.

Supervision (`src/runtime/workspace-processes.ts`):

- inactivity timeout: no output for the configured window kills the session
- dev servers, previews, and watchers started inside the workspace are killed and fail the session (Playwright-managed test servers are allowed)
- the CLI is spawned as a process-group leader and tracked in-process, so abort kills the whole tree

Models: `anthropic:<model-id>` (for example `anthropic:claude-opus-5-5`, `anthropic:claude-sonnet-5-5`, `anthropic:claude-haiku-4-5`). A bare model id is also accepted. The configured thinking level is recorded for provenance; Claude Code manages its own reasoning budget.

Environment overrides:

| Variable | Effect |
| --- | --- |
| `AEGIS_CLAUDE_BIN` | CLI to run (default `claude`) |
| `AEGIS_CLAUDE_SESSION_TIMEOUT_MS` | inactivity timeout (default 1,800,000) |
| `AEGIS_CLAUDE_MAX_TURNS` | adds `--max-turns` |
| `AEGIS_CLAUDE_EXTRA_ARGS` | extra CLI args, as a JSON array or whitespace-separated |

## Codex (`codex`)

Implementation: `src/runtime/codex-caste-runtime.ts`. Runs `codex exec` with `--json`, the configured model and reasoning effort, `workspace-write` sandbox (`danger-full-access` on Windows, where workspace-write shell execution is broken), and `--output-last-message` for the artifact. It shares the same process supervision as Claude Code.

## Pi (`pi`)

Implementation: `src/runtime/pi-caste-runtime.ts`. Runs the Pi coding agent in-process with jailed tools:

- file tools resolve paths inside the working directory and reject escapes and control-plane paths (`.aegis`, `.agora`, `.git`)
- Titan writes are limited to the allowed file scope; shell commands are checked for directory escapes, branch-changing git commands, GUI launchers, long-running servers, and out-of-scope package installs
- each caste gets a typed `emit_*` tool, and a repair prompt forces the tool call if the session ends without it

Environment overrides: `AEGIS_PI_SESSION_TIMEOUT_MS`, `AEGIS_PI_<CASTE>_TIMEOUT_MS`, `AEGIS_PI_TIMEOUT_RETRY_COUNT`, `AEGIS_PI_TIMEOUT_RETRY_DELAY_MS`.

## Scripted (`scripted`)

Implementation: `src/runtime/scripted-caste-runtime.ts`. Deterministic responses for seam tests and mock acceptance; Titan commits a proof file so git validation still runs. It is never evidence for the live proof.

## Adding An Adapter

1. Implement `CasteRuntime` in `src/runtime/<name>-caste-runtime.ts`.
2. Add the name to `RUNTIME_ADAPTER_NAMES` in `runtime-registry.ts` and decide its artifact emission mode.
3. Construct it in `create-caste-runtime.ts` and register its session-process terminator in `dispatch-runtime.ts`.
4. Add preflight probes in `src/cli/startup-probes.ts`.
5. Record the decision in `docs/AEGIS.md`; adapters get no privileged shortcuts.
