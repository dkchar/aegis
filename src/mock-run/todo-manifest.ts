import type { MockRunManifest } from "./types.js";

export const TODO_BASELINE_FILES: Record<string, string> = {
  ".gitignore": `# Beads / Dolt files (added by bd init)
.dolt/
*.db
.beads-credential-key
.aegis/config.json
.aegis/dispatch-state.json
.aegis/merge-queue.json
.aegis/mnemosyne.jsonl
.aegis/runtime-state.json
.aegis/labors/
.aegis/evals/
.aegis/mock-run-manifest.json
`,
  "README.md": `# Todo System Mock Run

Deterministic todo project seeded by Aegis for black-box orchestrator runs.
`,
  "package.json": `{
  "name": "aegis-mock-run",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "test": "node --test",
    "lint": "tsc --project tsconfig.json --noEmit"
  }
}`,
  "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": ".",
    "outDir": "dist",
    "strict": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}`,
  ".pi/settings.json": `{
  "defaultProvider": "google",
  "defaultModel": "gemma-4-31b-it",
  "defaultThinkingLevel": "high"
}`,
  "src/models/task.ts": `export interface Task {
  id: string;
  title: string;
  completed: boolean;
}
`,
  "src/store/task-store.ts": `import type { Task } from "../models/task.js";

export class TaskStore {
  private readonly tasks: Task[] = [];

  list(): Task[] {
    return [...this.tasks];
  }
}
`,
  "src/commands/create-task.ts": `export function createTask(title: string) {
  return { title };
}
`,
  "src/commands/list-tasks.ts": `export function listTasks(): string[] {
  return [];
}
`,
  "src/commands/complete-task.ts": `export function completeTask(taskId: string) {
  return taskId;
}
`,
  "src/cli.ts": `console.log("todo mock run");`,
  "src/reporting/summary.ts": `export function buildSummary(): string {
  return "0 tasks";
}
`,
  "tests/task-store.test.ts": `import assert from "node:assert/strict";
import test from "node:test";

test("baseline task store exists", () => {
  assert.equal(true, true);
});
`,
};

export const TODO_MOCK_RUN_ISSUES: MockRunManifest["issues"] = [
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
  {
    key: "foundation",
    title: "Foundation slice",
    description: "Coordination epic for foundation work.",
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
    description: "Lock the todo model, storage interface, and baseline test contract.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "foundation",
    blocks: [],
    labels: ["mock-run", "foundation", "contract"],
  },
  {
    key: "foundation.lane_a",
    title: "[foundation] Lane A",
    description: "Implement task model and in-memory store behavior.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "foundation",
    blocks: ["foundation.contract"],
    labels: ["mock-run", "foundation", "lane_a"],
  },
  {
    key: "foundation.lane_b",
    title: "[foundation] Lane B",
    description: "Implement shared validation and baseline test utilities.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "foundation",
    blocks: ["foundation.contract"],
    labels: ["mock-run", "foundation", "lane_b"],
  },
  {
    key: "foundation.gate",
    title: "[foundation] Gate",
    description: "Prove the foundation slice and unlock commands.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "foundation",
    blocks: ["foundation.lane_a", "foundation.lane_b"],
    labels: ["mock-run", "foundation", "gate"],
  },
  {
    key: "commands",
    title: "Commands slice",
    description: "Coordination epic for command work.",
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
    description: "Define command behavior for create, list, and complete flows.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "commands",
    blocks: ["foundation.gate"],
    labels: ["mock-run", "commands", "contract"],
  },
  {
    key: "commands.lane_a",
    title: "[commands] Lane A",
    description: "Implement create and list commands.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "commands",
    blocks: ["commands.contract"],
    labels: ["mock-run", "commands", "lane_a"],
  },
  {
    key: "commands.lane_b",
    title: "[commands] Lane B",
    description: "Implement complete-task behavior and command tests.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "commands",
    blocks: ["commands.contract"],
    labels: ["mock-run", "commands", "lane_b"],
  },
  {
    key: "commands.gate",
    title: "[commands] Gate",
    description: "Prove the command slice and unlock integration.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "commands",
    blocks: ["commands.lane_a", "commands.lane_b"],
    labels: ["mock-run", "commands", "gate"],
  },
  {
    key: "integration",
    title: "Integration slice",
    description: "Coordination epic for CLI and reporting work.",
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
    description: "Lock CLI integration, summary output, and end-to-end behavior.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "integration",
    blocks: ["commands.gate"],
    labels: ["mock-run", "integration", "contract"],
  },
  {
    key: "integration.lane_a",
    title: "[integration] Lane A",
    description: "Implement CLI wiring.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "integration",
    blocks: ["integration.contract"],
    labels: ["mock-run", "integration", "lane_a"],
  },
  {
    key: "integration.lane_b",
    title: "[integration] Lane B",
    description: "Implement reporting and end-to-end verification.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "integration",
    blocks: ["integration.contract"],
    labels: ["mock-run", "integration", "lane_b"],
  },
  {
    key: "integration.gate",
    title: "[integration] Gate",
    description: "Prove the integrated todo system.",
    issueType: "task",
    priority: 1,
    queueRole: "executable",
    parentKey: "integration",
    blocks: ["integration.lane_a", "integration.lane_b"],
    labels: ["mock-run", "integration", "gate"],
  },
];

export const TODO_READY_QUEUE_EXPECTATION = ["foundation.contract"] as const;

export const TODO_MOCK_RUN_MANIFEST: MockRunManifest = {
  repoName: "aegis-mock-run",
  beadsPrefix: "aegismockrun",
  baselineFiles: TODO_BASELINE_FILES,
  issues: TODO_MOCK_RUN_ISSUES,
  expectedInitialReadyKeys: [...TODO_READY_QUEUE_EXPECTATION],
};
