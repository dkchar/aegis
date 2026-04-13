import type { MockRunManifest } from "./types.js";

export const TODO_BASELINE_FILES: Record<string, string> = {
  ".gitignore": [
    "# Beads / Dolt files (added by bd init)",
    ".dolt/",
    "*.db",
    ".beads-credential-key",
    ".aegis/config.json",
    ".aegis/dispatch-state.json",
    ".aegis/merge-queue.json",
    ".aegis/mnemosyne.jsonl",
    ".aegis/runtime-state.json",
    ".aegis/labors/",
    ".aegis/evals/",
    ".aegis/mock-run-manifest.json",
    ".aegis/oracle/",
  ].join("\n"),
  ".pi/settings.json": JSON.stringify(
    {
      defaultProvider: "google",
      defaultModel: "gemma-4-31b-it",
      defaultThinkingLevel: "high",
    },
    null,
    2,
  ),
};

/**
 * Mock-run issue manifest for stress testing.
 *
 * Structure: 5 slices × 3 lanes each, with intentional file overlap between
 * lanes within slices, shared modules that require coordination, at least one
 * decomposable issue (triggers Oracle pause), and a merge-conflict-prone slice.
 *
 * Slice overview:
 *   foundation  — Core types, storage interfaces, validation (3 lanes, overlap on src/types/)
 *   commands    — CRUD operations (3 lanes, overlap on src/commands/index.ts)
 *   cli         — CLI surface, output formatting, reporting (3 lanes, overlap on src/cli/main.ts)
 *   integration — Config loading, e2e runners, fixture management (3 lanes, overlap on test helpers)
 *   stress      — Parallel execution, merge conflicts, decomposable issues (3 lanes, deliberate overlap)
 */
export const TODO_MOCK_RUN_ISSUES: MockRunManifest["issues"] = [
  // ── Program epic ────────────────────────────────────────────────────────
  {
    key: "todo-system",
    title: "Todo system program",
    description: "Program epic for the deterministic mock-run todo system.",
    issueType: "epic",
    priority: 1,
    queueRole: "coordination",
    parentKey: null,
    blocks: [],
    labels: ["mock-run", "program"],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SLICE 1: foundation — Core types, storage, validation
  // Overlap: all three lanes touch src/types/ (shared type definitions)
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: "foundation",
    title: "Foundation slice",
    description: "Coordination epic for foundation work: types, storage, validation.",
    issueType: "epic",
    priority: 1,
    queueRole: "coordination",
    parentKey: "todo-system",
    blocks: [],
    labels: ["mock-run", "slice", "foundation"],
  },
  {
    key: "foundation.contract",
    title: "[foundation] Contract seed",
    description:
      "Lock the todo model, storage interface, baseline types, and validation contract. " +
      "Define Task, TaskStatus, StorageBackend, and ValidationError shapes. " +
      "All three lanes will extend these types, so keep the interface minimal but complete.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "foundation",
    blocks: [],
    labels: ["mock-run", "foundation", "contract"],
  },
  {
    key: "foundation.lane_a",
    title: "[foundation] Lane A — Task model and in-memory store",
    description:
      "Implement the Task model class and an InMemoryStorage backend. " +
      "Shared file: extends src/types/task.ts (also touched by lane_b and lane_c). " +
      "Ensure your implementation satisfies the StorageBackend interface from the contract.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "foundation",
    blocks: ["foundation.contract"],
    labels: ["mock-run", "foundation", "lane_a"],
  },
  {
    key: "foundation.lane_b",
    title: "[foundation] Lane B — Validation engine and error taxonomy",
    description:
      "Implement the validation engine with a complete error taxonomy. " +
      "Shared file: extends src/types/task.ts (also touched by lane_a and lane_c). " +
      "Add validateTask(), ValidationError types, and boundary checks. " +
      "Coordinate with lane_a on type shape and lane_c on schema utilities.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "foundation",
    blocks: ["foundation.contract"],
    labels: ["mock-run", "foundation", "lane_b"],
  },
  {
    key: "foundation.lane_c",
    title: "[foundation] Lane C — Schema utilities and migration helpers",
    description:
      "Implement schema utilities, serialization helpers, and migration stubs. " +
      "Shared file: extends src/types/task.ts (also touched by lane_a and lane_b). " +
      "Add serializeTask(), deserializeTask(), and a migrateSchema() placeholder. " +
      "Must be compatible with the Task interface from the contract.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "foundation",
    blocks: ["foundation.contract"],
    labels: ["mock-run", "foundation", "lane_c"],
  },
  {
    key: "foundation.gate",
    title: "[foundation] Gate",
    description:
      "Prove the foundation slice: all three lanes merge cleanly, " +
      "types are consistent, and baseline tests pass. " +
      "Verify that src/types/task.ts has no merge conflicts after all lanes complete.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "foundation",
    blocks: ["foundation.lane_a", "foundation.lane_b", "foundation.lane_c"],
    labels: ["mock-run", "foundation", "gate"],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SLICE 2: commands — CRUD operations
  // Overlap: all three lanes touch src/commands/index.ts (shared module)
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: "commands",
    title: "Commands slice",
    description: "Coordination epic for command work: create, list, complete, delete, archive.",
    issueType: "epic",
    priority: 1,
    queueRole: "coordination",
    parentKey: "todo-system",
    blocks: [],
    labels: ["mock-run", "slice", "commands"],
  },
  {
    key: "commands.contract",
    title: "[commands] Contract seed",
    description:
      "Define the command interface, create/list/complete/delete/archive signatures, " +
      "and the shared command registry at src/commands/index.ts. " +
      "All three lanes will register their commands here — define the contract first.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "commands",
    blocks: ["foundation.gate"],
    labels: ["mock-run", "commands", "contract"],
  },
  {
    key: "commands.lane_a",
    title: "[commands] Lane A — Create and list commands",
    description:
      "Implement create-task and list-tasks commands. " +
      "Shared file: registers in src/commands/index.ts (also touched by lane_b and lane_c). " +
      "Create should accept title/description/priority and return a Task. " +
      "List should support filtering by status and pagination.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "commands",
    blocks: ["commands.contract"],
    labels: ["mock-run", "commands", "lane_a"],
  },
  {
    key: "commands.lane_b",
    title: "[commands] Lane B — Complete and update commands",
    description:
      "Implement complete-task and update-task commands. " +
      "Shared file: registers in src/commands/index.ts (also touched by lane_a and lane_c). " +
      "Complete should transition status and record completion timestamp. " +
      "Update should allow patching title, description, and priority.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "commands",
    blocks: ["commands.contract"],
    labels: ["mock-run", "commands", "lane_b"],
  },
  {
    key: "commands.lane_c",
    title: "[commands] Lane C — Delete and archive commands",
    description:
      "Implement delete-task and archive-task commands. " +
      "Shared file: registers in src/commands/index.ts (also touched by lane_a and lane_b). " +
      "Delete should remove from storage; archive should mark as archived without deletion. " +
      "Add soft-delete semantics and an archive query filter.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "commands",
    blocks: ["commands.contract"],
    labels: ["mock-run", "commands", "lane_c"],
  },
  {
    key: "commands.gate",
    title: "[commands] Gate",
    description:
      "Prove the command slice: all CRUD operations work, src/commands/index.ts merges cleanly, " +
      "and the command registry exports all six commands without conflict.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "commands",
    blocks: ["commands.lane_a", "commands.lane_b", "commands.lane_c"],
    labels: ["mock-run", "commands", "gate"],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SLICE 3: cli — CLI surface, output formatting, reporting
  // Overlap: all three lanes touch src/cli/main.ts (shared module)
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: "cli",
    title: "CLI slice",
    description: "Coordination epic for CLI surface, formatting, and reporting.",
    issueType: "epic",
    priority: 1,
    queueRole: "coordination",
    parentKey: "todo-system",
    blocks: [],
    labels: ["mock-run", "slice", "cli"],
  },
  {
    key: "cli.contract",
    title: "[cli] Contract seed",
    description:
      "Define the CLI entry point at src/cli/main.ts, argument parsing contract, " +
      "and output formatting interface. " +
      "All three lanes will add routes to main.ts — define the routing pattern first.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "cli",
    blocks: ["commands.gate"],
    labels: ["mock-run", "cli", "contract"],
  },
  {
    key: "cli.lane_a",
    title: "[cli] Lane A — Argument parsing and command routing",
    description:
      "Implement argument parsing (subcommands: create, list, complete, delete, archive, status) " +
      "and route to the command layer. " +
      "Shared file: adds routes to src/cli/main.ts (also touched by lane_b and lane_c). " +
      "Use a consistent dispatch pattern that lane_b and lane_c can extend.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "cli",
    blocks: ["cli.contract"],
    labels: ["mock-run", "cli", "lane_a"],
  },
  {
    key: "cli.lane_b",
    title: "[cli] Lane B — Output formatting (table, JSON, CSV)",
    description:
      "Implement output formatters for table, JSON, and CSV formats. " +
      "Shared file: adds formatter imports to src/cli/main.ts (also touched by lane_a and lane_c). " +
      "Support --format flag with auto-detection when stdout is not a TTY.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "cli",
    blocks: ["cli.contract"],
    labels: ["mock-run", "cli", "lane_b"],
  },
  {
    key: "cli.lane_c",
    title: "[cli] Lane C — Summary dashboard and status reporting",
    description:
      "Implement the summary dashboard (task counts by status, recent activity, upcoming deadlines). " +
      "Shared file: adds status endpoint to src/cli/main.ts (also touched by lane_a and lane_b). " +
      "Use the formatter from lane_b for consistent output.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "cli",
    blocks: ["cli.contract"],
    labels: ["mock-run", "cli", "lane_c"],
  },
  {
    key: "cli.gate",
    title: "[cli] Gate",
    description:
      "Prove the CLI slice: all subcommands route correctly, src/cli/main.ts merges cleanly, " +
      "and output formatting works for all three formats across all commands.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "cli",
    blocks: ["cli.lane_a", "cli.lane_b", "cli.lane_c"],
    labels: ["mock-run", "cli", "gate"],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SLICE 4: integration — Config loading, e2e runner, fixture management
  // Overlap: all three lanes touch tests/integration/helpers.ts (shared test utils)
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: "integration",
    title: "Integration slice",
    description: "Coordination epic for config loading, e2e scenarios, and fixture management.",
    issueType: "epic",
    priority: 1,
    queueRole: "coordination",
    parentKey: "todo-system",
    blocks: [],
    labels: ["mock-run", "slice", "integration"],
  },
  {
    key: "integration.contract",
    title: "[integration] Contract seed",
    description:
      "Define the config file format, e2e scenario schema, and shared test helpers. " +
      "Shared file: tests/integration/helpers.ts (touched by all three lanes). " +
      "Establish the fixture loading pattern and scenario runner interface.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "integration",
    blocks: ["cli.gate"],
    labels: ["mock-run", "integration", "contract"],
  },
  {
    key: "integration.lane_a",
    title: "[integration] Lane A — Config file loading and validation",
    description:
      "Implement .todosrc config file loading with JSON schema validation. " +
      "Shared file: extends tests/integration/helpers.ts with config fixtures (also touched by lane_b and lane_c). " +
      "Support default config, environment overrides, and validation errors.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "integration",
    blocks: ["integration.contract"],
    labels: ["mock-run", "integration", "lane_a"],
  },
  {
    key: "integration.lane_b",
    title: "[integration] Lane B — End-to-end scenario runner",
    description:
      "Implement the scenario runner that replays a sequence of CLI commands " +
      "and verifies expected output. " +
      "Shared file: extends tests/integration/helpers.ts with scenario helpers (also touched by lane_a and lane_c). " +
      "Support scripted sessions with expected stdout/stderr assertions.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "integration",
    blocks: ["integration.contract"],
    labels: ["mock-run", "integration", "lane_b"],
  },
  {
    key: "integration.lane_c",
    title: "[integration] Lane C — Fixture generation and test data",
    description:
      "Implement fixture generators for tasks, configs, and scenario files. " +
      "Shared file: extends tests/integration/helpers.ts with fixture generators (also touched by lane_a and lane_b). " +
      "Include edge-case fixtures: empty store, max tasks, invalid data, Unicode titles.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "integration",
    blocks: ["integration.contract"],
    labels: ["mock-run", "integration", "lane_c"],
  },
  {
    key: "integration.gate",
    title: "[integration] Gate",
    description:
      "Prove the integration slice: config loading works, scenarios replay correctly, " +
      "fixtures generate valid test data, and tests/integration/helpers.ts merges cleanly.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "integration",
    blocks: ["integration.lane_a", "integration.lane_b", "integration.lane_c"],
    labels: ["mock-run", "integration", "gate"],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SLICE 5: stress — Parallel execution, merge conflicts, decomposable issues
  // Overlap: deliberate cross-cutting file touches to force merge conflicts
  // and test decomposition handling
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: "stress",
    title: "Stress slice",
    description:
      "Coordination epic for parallel execution, merge conflict handling, and decomposable issues. " +
      "This slice is designed to stress-test the orchestrator: overlapping file ownership, " +
      "complex issues that trigger Oracle decomposition, and intentional merge conflicts.",
    issueType: "epic",
    priority: 1,
    queueRole: "coordination",
    parentKey: "todo-system",
    blocks: [],
    labels: ["mock-run", "slice", "stress"],
  },
  {
    key: "stress.contract",
    title: "[stress] Contract seed",
    description:
      "Define the parallel execution interface, merge conflict resolution strategy, " +
      "and decomposable issue contract. " +
      "Shared files touched by all lanes: src/commands/index.ts (extends command registry), " +
      "src/cli/main.ts (adds stress subcommands), tests/integration/helpers.ts (adds stress fixtures). " +
      "Define how parallel tasks should be dispatched and how conflicts should be reported.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "stress",
    blocks: ["integration.gate"],
    labels: ["mock-run", "stress", "contract"],
  },
  {
    key: "stress.lane_a",
    title: "[stress] Lane A — Parallel batch execution support",
    description:
      "Implement parallel batch execution: accept a file of task operations and execute them " +
      "concurrently with configurable worker count. " +
      "Shared files: " +
      "  - extends src/commands/index.ts with batch-register command (overlaps with commands slice registry) " +
      "  - extends src/cli/main.ts with --parallel flag (overlaps with CLI routing) " +
      "This lane deliberately touches files modified by other slices to create merge pressure. " +
      "Use the command registry pattern from the commands slice and the routing pattern from the CLI slice.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "stress",
    blocks: ["stress.contract"],
    labels: ["mock-run", "stress", "lane_a", "parallel"],
  },
  {
    key: "stress.lane_b",
    title: "[stress] Lane B — Merge conflict detection and reporting",
    description:
      "Implement merge conflict detection: when two tasks modify the same field concurrently, " +
      "flag the conflict and produce a resolution report. " +
      "Shared files: " +
      "  - extends src/commands/index.ts with conflict-report command (overlaps with lane_a and lane_c) " +
      "  - extends tests/integration/helpers.ts with conflict-generating fixtures " +
      "  - adds src/commands/conflict.ts (new file, but also imported by lane_c's registry entry) " +
      "Deliberately imports and extends the same registry as lane_a to create a merge conflict at " +
      "src/commands/index.ts. Both lanes add their import and registration near the same location.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "stress",
    blocks: ["stress.contract"],
    labels: ["mock-run", "stress", "lane_b", "conflict"],
  },
  {
    key: "stress.lane_c",
    title: "[stress] Lane C — Decomposable issue handling",
    description:
      "Implement decomposable issue support: when a task description is too complex (contains " +
      "multiple distinct objectives), the Oracle should pause and recommend sub-task decomposition. " +
      "Shared files: " +
      "  - extends src/commands/index.ts with decompose command (overlaps with lane_a and lane_b) " +
      "  - extends src/cli/main.ts with --decompose flag (overlaps with lane_a's --parallel flag) " +
      "  - extends tests/integration/helpers.ts with complexity-threshold fixtures " +
      "Deliberately touches the same shared files as lane_a and lane_b to create merge pressure. " +
      "The decomposition logic should be testable: a complexity threshold determines whether an issue " +
      "should be decomposed or can proceed directly to Titan.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "stress",
    blocks: ["stress.contract"],
    labels: ["mock-run", "stress", "lane_c", "decompose"],
  },
  {
    key: "stress.gate",
    title: "[stress] Gate",
    description:
      "Prove the stress slice: parallel execution works, merge conflicts are detected and reported, " +
      "decomposable issues trigger Oracle pause with sub-task recommendations, " +
      "and all shared files (src/commands/index.ts, src/cli/main.ts, tests/integration/helpers.ts) " +
      "merge cleanly after all three lanes complete. " +
      "The gate should verify that the orchestrator handled concurrent dispatch, conflict detection, " +
      "and decomposition without data loss or corruption.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "stress",
    blocks: ["stress.lane_a", "stress.lane_b", "stress.lane_c"],
    labels: ["mock-run", "stress", "gate"],
  },
];

/**
 * Expected initial ready queue.
 *
 * Only foundation.contract is unblocked at seed time.
 * Everything else has at least one dependency.
 */
export const TODO_READY_QUEUE_EXPECTATION = ["foundation.contract"] as const;

export const TODO_MOCK_RUN_MANIFEST: MockRunManifest = {
  repoName: "aegis-mock-run",
  beadsPrefix: "aegismockrun",
  baselineFiles: TODO_BASELINE_FILES,
  issues: TODO_MOCK_RUN_ISSUES,
  expectedInitialReadyKeys: [...TODO_READY_QUEUE_EXPECTATION],
};
