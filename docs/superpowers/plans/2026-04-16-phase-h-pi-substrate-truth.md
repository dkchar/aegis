# Phase H Pi Substrate Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Aegis config truly control live Pi execution, add auth-aware model preflight, and persist visible session metadata without spending paid model tokens in automated tests.

**Architecture:** Add one small config helper for caste-wide maps, one Pi model-resolution module that validates exact configured refs against authenticated providers, and one transcript/metadata persistence path reused by all castes. Keep startup and seam tests deterministic, keep scripted runtime intact, and make mock-run live-ready through config rather than hardcoded provider/model assumptions.

**Tech Stack:** TypeScript, Vitest, existing `@mariozechner/pi-ai` and `@mariozechner/pi-coding-agent` SDKs, git worktrees, Beads-backed mock-run seeding

---

## File Structure

**Create**
- `src/config/caste-config.ts` - shared caste key list and helpers for building per-caste config maps without copy-paste hardcoding
- `src/runtime/pi-model-config.ts` - parse model refs, resolve exact configured model for a caste, list authenticated providers, and validate config against Pi registry/auth state
- `tests/unit/runtime/pi-model-config.test.ts` - deterministic unit coverage for config-driven model resolution and provider-auth failures

**Modify**
- `src/config/schema.ts` - add `thinking` config domain and exported thinking-level type
- `src/config/defaults.ts` - move repeated per-caste defaults to helper-built maps
- `src/config/load-config.ts` - validate, merge, and patch `thinking`
- `src/config/init-project.ts` - seed config with new `thinking` domain
- `src/cli/start.ts` - replace hardcoded Pi model validation with auth-aware configured model validation
- `src/runtime/caste-runtime.ts` - extend runtime input/result with model/thinking/session metadata needed for proof artifacts
- `src/runtime/create-caste-runtime.ts` - pass repo root/config into Pi runtime instead of constructing blind Pi runtime
- `src/runtime/pi-caste-runtime.ts` - create Pi sessions with exact configured model and thinking level
- `src/runtime/scripted-caste-runtime.ts` - echo configured model/thinking/session metadata so seam tests stay structurally honest
- `src/core/artifact-store.ts` - allow named transcript artifacts per issue/caste without overwriting
- `src/core/caste-runner.ts` - persist transcript/session metadata artifacts for every caste run
- `src/mock-run/seed-mock-run.ts` - stop hardcoding `google`/`gemma`; seed mock-run through centralized config helpers and runtime option
- `src/mock-run/todo-manifest.ts` - stop hardcoding project-local Pi defaults outside config-driven live defaults
- `tests/fixtures/config/default-config.json` - match new default config shape
- `tests/unit/config/load-config.test.ts` - cover `thinking` validation/merge behavior
- `tests/integration/config/init-project.test.ts` - assert seeded config includes `thinking`
- `tests/unit/cli/startup-preflight.test.ts` - cover auth-aware provider/model failures
- `tests/unit/cli/start.test.ts` - cover start path with configured model validation
- `tests/unit/runtime/create-caste-runtime.test.ts` - assert Pi runtime factory receives config-driven dependencies
- `tests/unit/runtime/scripted-caste-runtime.test.ts` - assert scripted runtime echoes metadata shape
- `tests/unit/core/artifact-store.test.ts` - cover named transcript artifact paths
- `tests/unit/core/caste-runner.test.ts` - assert transcript/session metadata persistence
- `tests/unit/mock-run/seed-mock-run.test.ts` - assert mock-run config uses centralized live defaults and optional runtime selection

**Verification commands**
- `npm test -- tests/unit/config/load-config.test.ts tests/integration/config/init-project.test.ts`
- `npm test -- tests/unit/runtime/pi-model-config.test.ts tests/unit/cli/startup-preflight.test.ts tests/unit/cli/start.test.ts`
- `npm test -- tests/unit/runtime/create-caste-runtime.test.ts tests/unit/runtime/scripted-caste-runtime.test.ts tests/unit/core/artifact-store.test.ts tests/unit/core/caste-runner.test.ts`
- `npm test -- tests/unit/mock-run/seed-mock-run.test.ts`
- `npm test`

---

### Task 1: Add config-driven caste maps and `thinking`

**Files:**
- Create: `src/config/caste-config.ts`
- Modify: `src/config/schema.ts`, `src/config/defaults.ts`, `src/config/load-config.ts`, `src/config/init-project.ts`, `tests/fixtures/config/default-config.json`, `tests/unit/config/load-config.test.ts`, `tests/integration/config/init-project.test.ts`
- Test: `tests/unit/config/load-config.test.ts`, `tests/integration/config/init-project.test.ts`

- [ ] **Step 1: Write failing tests for `thinking` defaults and validation**

Add these assertions to [tests/unit/config/load-config.test.ts](/C:/dev/aegis/.worktrees/real-pi-proof-phases/tests/unit/config/load-config.test.ts:59) and [tests/integration/config/init-project.test.ts](/C:/dev/aegis/.worktrees/real-pi-proof-phases/tests/integration/config/init-project.test.ts:1):

```ts
it("defines per-caste thinking defaults alongside model defaults", () => {
  expect(DEFAULT_AEGIS_CONFIG.thinking).toEqual({
    oracle: "medium",
    titan: "medium",
    sentinel: "medium",
    janus: "medium",
  });
});

it("fills missing thinking entries from defaults", () => {
  const projectRoot = createTempProjectRoot();

  writeConfigFixture(projectRoot, {
    thinking: {
      titan: "high",
    },
  });

  expect(loadConfig(projectRoot).thinking).toEqual({
    oracle: "medium",
    titan: "high",
    sentinel: "medium",
    janus: "medium",
  });
});

it("rejects non-string thinking values", () => {
  const projectRoot = createTempProjectRoot();

  writeConfigFixture(projectRoot, {
    thinking: {
      oracle: 5,
    },
  });

  expect(() => loadConfig(projectRoot)).toThrow(
    'Expected "thinking.oracle" to be a string',
  );
});
```

Add this init assertion:

```ts
expect(readConfig(root)).toMatchObject({
  thinking: {
    oracle: "medium",
    titan: "medium",
    sentinel: "medium",
    janus: "medium",
  },
});
```

- [ ] **Step 2: Run targeted tests to verify failure**

Run:

```bash
npm test -- tests/unit/config/load-config.test.ts tests/integration/config/init-project.test.ts
```

Expected:
- FAIL because `thinking` does not exist on `AegisConfig`
- FAIL because seeded config fixture does not include `thinking`

- [ ] **Step 3: Add caste config helper and wire `thinking` through schema/defaults/load/init**

Create `src/config/caste-config.ts`:

```ts
export const CASTE_CONFIG_KEYS = [
  "oracle",
  "titan",
  "sentinel",
  "janus",
] as const;

export type CasteConfigKey = (typeof CASTE_CONFIG_KEYS)[number];

export type CasteConfigMap<T> = Record<CasteConfigKey, T>;

export function buildUniformCasteConfig<T>(value: T): CasteConfigMap<T> {
  return {
    oracle: value,
    titan: value,
    sentinel: value,
    janus: value,
  };
}
```

Update `src/config/schema.ts` to use shared caste keys for both model and thinking domains:

```ts
import { CASTE_CONFIG_KEYS, type CasteConfigMap } from "./caste-config.js";

export const MODEL_KEYS = CASTE_CONFIG_KEYS;
export const THINKING_KEYS = CASTE_CONFIG_KEYS;

export type AegisThinkingLevel = "off" | "low" | "medium" | "high";

export const CONFIG_TOP_LEVEL_KEYS = [
  "runtime",
  "models",
  "thinking",
  "concurrency",
  "thresholds",
  "janus",
  "labor",
  "git",
] as const;

export interface AegisConfig {
  runtime: string;
  models: CasteConfigMap<string>;
  thinking: CasteConfigMap<AegisThinkingLevel>;
  // keep existing domains unchanged below
}
```

Update `src/config/defaults.ts`:

```ts
import { buildUniformCasteConfig } from "./caste-config.js";
import type { AegisConfig } from "./schema.js";

export const DEFAULT_AEGIS_CONFIG: AegisConfig = {
  runtime: "scripted",
  models: buildUniformCasteConfig("openai-codex:gpt-5.4-mini"),
  thinking: buildUniformCasteConfig("medium"),
  // keep current concurrency/thresholds/janus/labor/git values
};
```

Update `src/config/load-config.ts`:

```ts
import { THINKING_KEYS } from "./schema.js";

if ("thinking" in config) {
  assertRecord(config.thinking, "thinking");
  validateKnownKeys(config.thinking, "thinking", THINKING_KEYS);
  for (const key of Object.keys(config.thinking)) {
    assertString(config.thinking[key], `thinking.${key}`);
  }
}

// mergeConfig
thinking: {
  ...DEFAULT_AEGIS_CONFIG.thinking,
  ...config.thinking,
},

// applyConfigPatch
thinking: {
  ...current.thinking,
  ...partial.thinking,
},
```

Update `src/config/init-project.ts` only by continuing to serialize `DEFAULT_AEGIS_CONFIG`; no separate hardcoded `thinking` seed should appear there.

Update `tests/fixtures/config/default-config.json`:

```json
{
  "runtime": "scripted",
  "models": {
    "oracle": "openai-codex:gpt-5.4-mini",
    "titan": "openai-codex:gpt-5.4-mini",
    "sentinel": "openai-codex:gpt-5.4-mini",
    "janus": "openai-codex:gpt-5.4-mini"
  },
  "thinking": {
    "oracle": "medium",
    "titan": "medium",
    "sentinel": "medium",
    "janus": "medium"
  }
}
```

Keep remaining existing domains from current fixture unchanged.

- [ ] **Step 4: Run targeted tests to verify pass**

Run:

```bash
npm test -- tests/unit/config/load-config.test.ts tests/integration/config/init-project.test.ts
```

Expected:
- PASS
- seeded config fixture and init path both include `thinking`

- [ ] **Step 5: Commit**

```bash
git add src/config/caste-config.ts src/config/schema.ts src/config/defaults.ts src/config/load-config.ts src/config/init-project.ts tests/fixtures/config/default-config.json tests/unit/config/load-config.test.ts tests/integration/config/init-project.test.ts
git commit -m "feat: add config-driven thinking defaults"
```

### Task 2: Replace syntax-only Pi validation with auth-aware configured model resolution

**Files:**
- Create: `src/runtime/pi-model-config.ts`, `tests/unit/runtime/pi-model-config.test.ts`
- Modify: `src/cli/start.ts`, `tests/unit/cli/startup-preflight.test.ts`, `tests/unit/cli/start.test.ts`
- Test: `tests/unit/runtime/pi-model-config.test.ts`, `tests/unit/cli/startup-preflight.test.ts`, `tests/unit/cli/start.test.ts`

- [ ] **Step 1: Write failing tests for authenticated-provider-aware validation**

Create `tests/unit/runtime/pi-model-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";
import {
  resolveConfiguredCasteModel,
  verifyConfiguredPiModels,
} from "../../../src/runtime/pi-model-config.js";

function makeConfig() {
  return {
    ...DEFAULT_AEGIS_CONFIG,
    runtime: "pi",
    models: {
      ...DEFAULT_AEGIS_CONFIG.models,
      titan: "openai-codex:gpt-5.4-mini",
      sentinel: "openai-codex:gpt-5.4-mini",
    },
  };
}

describe("resolveConfiguredCasteModel", () => {
  it("returns configured provider/model/thinking for a caste", () => {
    const config = makeConfig();

    const resolved = resolveConfiguredCasteModel(config, "titan", {
      authenticatedProviders: ["openai-codex"],
      availableModels: [
        { provider: "openai-codex", id: "gpt-5.4-mini" },
      ],
    });

    expect(resolved).toMatchObject({
      caste: "titan",
      reference: "openai-codex:gpt-5.4-mini",
      provider: "openai-codex",
      modelId: "gpt-5.4-mini",
      thinkingLevel: "medium",
    });
  });

  it("fails when configured provider is not authenticated", () => {
    expect(() => resolveConfiguredCasteModel(makeConfig(), "titan", {
      authenticatedProviders: ["anthropic"],
      availableModels: [],
    })).toThrow('Configured provider "openai-codex" for "titan" is not authenticated');
  });
});

describe("verifyConfiguredPiModels", () => {
  it("returns authenticated provider guidance without listing full model universe", () => {
    const probe = verifyConfiguredPiModels(makeConfig(), {
      authenticatedProviders: ["anthropic"],
      availableModels: [],
    });

    expect(probe.ok).toBe(false);
    expect(probe.detail).toContain('Configured provider "openai-codex"');
    expect(probe.detail).toContain("Authenticated providers: anthropic");
    expect(probe.detail).not.toContain("gemini");
  });
});
```

Extend startup-preflight/start tests with one blocked-start case:

```ts
expect(report.checks[6]).toMatchObject({
  id: "model_refs",
  status: "fail",
});
expect(report.checks[6]?.detail).toContain('Authenticated providers: anthropic');
```

- [ ] **Step 2: Run targeted tests to verify failure**

Run:

```bash
npm test -- tests/unit/runtime/pi-model-config.test.ts tests/unit/cli/startup-preflight.test.ts tests/unit/cli/start.test.ts
```

Expected:
- FAIL because `src/runtime/pi-model-config.ts` does not exist
- FAIL because current `verifyConfiguredModels()` still uses provider list plus hardcoded `pi -> google`

- [ ] **Step 3: Implement exact configured model resolver with authenticated-provider filtering**

Create `src/runtime/pi-model-config.ts`:

```ts
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { StartupPreflightProbeResult } from "../cli/startup-preflight.js";
import type { CasteConfigKey } from "../config/caste-config.js";
import type { AegisConfig } from "../config/schema.js";

type AvailableModel = {
  provider: string;
  id: string;
};

export interface PiModelConfigDeps {
  authenticatedProviders?: string[];
  availableModels?: AvailableModel[];
}

export interface ResolvedConfiguredCasteModel {
  caste: CasteConfigKey;
  reference: string;
  provider: string;
  modelId: string;
  thinkingLevel: AegisConfig["thinking"][CasteConfigKey];
}

function parseModelReference(reference: string) {
  const separator = reference.indexOf(":");
  if (separator === -1) {
    throw new Error(`Invalid configured model: expected "<provider>:<model-id>" but got "${reference}"`);
  }

  return {
    provider: reference.slice(0, separator),
    modelId: reference.slice(separator + 1),
  };
}

function loadRuntimeDeps(): Required<PiModelConfigDeps> {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  return {
    authenticatedProviders: authStorage.list().sort(),
    availableModels: modelRegistry.getAvailable().map((model) => ({
      provider: model.provider,
      id: model.id,
    })),
  };
}

export function resolveConfiguredCasteModel(
  config: AegisConfig,
  caste: CasteConfigKey,
  deps?: PiModelConfigDeps,
): ResolvedConfiguredCasteModel {
  const runtimeDeps = deps?.authenticatedProviders && deps?.availableModels
    ? {
        authenticatedProviders: deps.authenticatedProviders,
        availableModels: deps.availableModels,
      }
    : loadRuntimeDeps();
  const reference = config.models[caste];
  const { provider, modelId } = parseModelReference(reference);

  if (!runtimeDeps.authenticatedProviders.includes(provider)) {
    const providers = runtimeDeps.authenticatedProviders.join(", ") || "none";
    throw new Error(
      `Configured provider "${provider}" for "${caste}" is not authenticated. Authenticated providers: ${providers}`,
    );
  }

  const match = runtimeDeps.availableModels.find((model) =>
    model.provider === provider && model.id === modelId
  );

  if (!match) {
    throw new Error(
      `Configured model "${reference}" for "${caste}" is not available from authenticated provider "${provider}"`,
    );
  }

  return {
    caste,
    reference,
    provider,
    modelId,
    thinkingLevel: config.thinking[caste],
  };
}

export function verifyConfiguredPiModels(
  config: AegisConfig,
  deps?: PiModelConfigDeps,
): StartupPreflightProbeResult {
  if (config.runtime !== "pi") {
    return {
      ok: true,
      detail: `Runtime "${config.runtime}" does not require Pi model validation.`,
    };
  }

  try {
    resolveConfiguredCasteModel(config, "oracle", deps);
    resolveConfiguredCasteModel(config, "titan", deps);
    resolveConfiguredCasteModel(config, "sentinel", deps);
    resolveConfiguredCasteModel(config, "janus", deps);
    return {
      ok: true,
      detail: "Configured model refs are valid for authenticated providers.",
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      fix: "authenticate the configured provider or update `.aegis/config.json` to an available provider:model pair",
    };
  }
}
```

Update `src/cli/start.ts`:

```ts
import { verifyConfiguredPiModels } from "../runtime/pi-model-config.js";

// remove getModels/getProviders imports and delete verifyConfiguredModels()

verifyModelRefs: verifyConfiguredPiModels,
```

Do not keep `provider === "pi" ? "google" : provider` anywhere.

- [ ] **Step 4: Run targeted tests to verify pass**

Run:

```bash
npm test -- tests/unit/runtime/pi-model-config.test.ts tests/unit/cli/startup-preflight.test.ts tests/unit/cli/start.test.ts
```

Expected:
- PASS
- blocked-start messages mention authenticated providers only
- no test depends on live provider login

- [ ] **Step 5: Commit**

```bash
git add src/runtime/pi-model-config.ts src/cli/start.ts tests/unit/runtime/pi-model-config.test.ts tests/unit/cli/startup-preflight.test.ts tests/unit/cli/start.test.ts
git commit -m "feat: validate pi models against auth state"
```

### Task 3: Inject configured model/thinking into runtimes and persist session metadata

**Files:**
- Modify: `src/runtime/caste-runtime.ts`, `src/runtime/create-caste-runtime.ts`, `src/runtime/pi-caste-runtime.ts`, `src/runtime/scripted-caste-runtime.ts`, `src/core/artifact-store.ts`, `src/core/caste-runner.ts`, `tests/unit/runtime/create-caste-runtime.test.ts`, `tests/unit/runtime/scripted-caste-runtime.test.ts`, `tests/unit/core/artifact-store.test.ts`, `tests/unit/core/caste-runner.test.ts`
- Test: `tests/unit/runtime/create-caste-runtime.test.ts`, `tests/unit/runtime/scripted-caste-runtime.test.ts`, `tests/unit/core/artifact-store.test.ts`, `tests/unit/core/caste-runner.test.ts`

- [ ] **Step 1: Write failing tests for runtime metadata and named transcripts**

Add these runtime assertions:

```ts
expect(createPiRuntime).toHaveBeenCalledWith({
  root: "repo",
  modelResolver: expect.any(Function),
});
```

```ts
expect(result).toMatchObject({
  modelRef: "openai-codex:gpt-5.4-mini",
  provider: "openai-codex",
  modelId: "gpt-5.4-mini",
  thinkingLevel: "medium",
});
```

Extend artifact-store test:

```ts
const ref = persistArtifact(root, {
  family: "transcripts",
  issueId: "aegis-123",
  artifactId: "titan",
  artifact: { prompt: "Implement issue" },
});

expect(ref).toBe(path.join(".aegis", "transcripts", "aegis-123--titan.json"));
```

Extend caste-runner test:

```ts
expect(readJson(path.join(root, ".aegis", "transcripts", "ISSUE-1--titan.json"))).toMatchObject({
  issueId: "ISSUE-1",
  caste: "titan",
  modelRef: "openai-codex:gpt-5.4-mini",
  thinkingLevel: "medium",
  workingDirectory: expect.stringContaining(".aegis"),
  prompt: expect.stringContaining("Implement ISSUE-1"),
});
```

- [ ] **Step 2: Run targeted tests to verify failure**

Run:

```bash
npm test -- tests/unit/runtime/create-caste-runtime.test.ts tests/unit/runtime/scripted-caste-runtime.test.ts tests/unit/core/artifact-store.test.ts tests/unit/core/caste-runner.test.ts
```

Expected:
- FAIL because runtime input/result do not expose model metadata
- FAIL because artifact store cannot write named transcript files

- [ ] **Step 3: Implement config-driven Pi session creation and transcript persistence**

Update `src/runtime/caste-runtime.ts`:

```ts
import type { CasteConfigKey } from "../config/caste-config.js";
import type { AegisThinkingLevel } from "../config/schema.js";

export type CasteName = CasteConfigKey;

export interface CasteRunInput {
  caste: CasteName;
  issueId: string;
  root: string;
  workingDirectory: string;
  prompt: string;
  modelRef: string;
  provider: string;
  modelId: string;
  thinkingLevel: AegisThinkingLevel;
}

export interface CasteSessionResult {
  sessionId: string;
  caste: CasteName;
  status: "succeeded" | "failed";
  outputText: string;
  messageLog: string[];
  toolsUsed: string[];
  modelRef: string;
  provider: string;
  modelId: string;
  thinkingLevel: AegisThinkingLevel;
  startedAt: string;
  finishedAt: string;
  error?: string;
}
```

Update `src/runtime/create-caste-runtime.ts` to inject repo-aware model resolution:

```ts
import { resolveConfiguredCasteModel } from "./pi-model-config.js";
import { loadConfig } from "../config/load-config.js";

export interface CreatePiRuntimeContext {
  root: string;
}

export interface CreateCasteRuntimeOptions {
  createPiRuntime?: (context: CreatePiRuntimeContext) => CasteRuntime;
  createScriptedRuntime?: () => CasteRuntime;
}

export function createCasteRuntime(
  runtime: string,
  options: CreateCasteRuntimeOptions = {},
  context: CreatePiRuntimeContext = { root: process.cwd() },
): CasteRuntime {
  const createPiRuntime = options.createPiRuntime
    ?? ((runtimeContext) => new PiCasteRuntime({
      root: runtimeContext.root,
      resolveModel: (caste) => resolveConfiguredCasteModel(loadConfig(runtimeContext.root), caste),
    }));

  // keep scripted path unchanged except signature
}
```

Update `src/runtime/pi-caste-runtime.ts`:

```ts
import { AuthStorage, ModelRegistry, createAgentSession } from "@mariozechner/pi-coding-agent";

export interface PiCasteRuntimeOptions {
  root: string;
  resolveModel: (caste: CasteName) => {
    reference: string;
    provider: string;
    modelId: string;
    thinkingLevel: AegisThinkingLevel;
  };
}

export class PiCasteRuntime implements CasteRuntime {
  constructor(private readonly options: PiCasteRuntimeOptions) {}

  async run(input: CasteRunInput): Promise<CasteSessionResult> {
    const selection = this.options.resolveModel(input.caste);
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);
    const model = modelRegistry.find(selection.provider, selection.modelId);

    if (!model) {
      throw new Error(`Configured model "${selection.reference}" for "${input.caste}" could not be loaded`);
    }

    const { session } = await createAgentSession({
      cwd: input.workingDirectory,
      authStorage,
      modelRegistry,
      model,
      thinkingLevel: selection.thinkingLevel,
      tools: resolveTools(input.caste),
    });

    // keep existing event subscription, but return messageLog and selection metadata
  }
}
```

Update `src/runtime/scripted-caste-runtime.ts` so scripted responses include:

```ts
return {
  sessionId: `${input.caste}-${input.issueId}-scripted`,
  caste: input.caste,
  status: "succeeded",
  outputText,
  messageLog: [outputText],
  toolsUsed,
  modelRef: input.modelRef,
  provider: input.provider,
  modelId: input.modelId,
  thinkingLevel: input.thinkingLevel,
  startedAt,
  finishedAt,
};
```

Update `src/core/artifact-store.ts`:

```ts
export interface PersistArtifactInput {
  family: "oracle" | "titan" | "sentinel" | "janus" | "transcripts";
  issueId: string;
  artifactId?: string;
  artifact: unknown;
}

function resolveArtifactPath(root: string, family: PersistArtifactInput["family"], issueId: string, artifactId?: string) {
  const fileName = artifactId ? `${issueId}--${artifactId}.json` : `${issueId}.json`;
  return path.join(path.resolve(root), ".aegis", family, fileName);
}
```

Update `src/core/caste-runner.ts` before caste-specific artifact persistence:

```ts
function persistSessionTranscript(
  root: string,
  action: RuntimeCasteAction,
  input: CasteRunInput,
  result: CasteSessionResult,
) {
  return persistArtifact(root, {
    family: "transcripts",
    issueId: input.issueId,
    artifactId: input.caste,
    artifact: {
      issueId: input.issueId,
      caste: input.caste,
      action,
      prompt: input.prompt,
      workingDirectory: input.workingDirectory,
      modelRef: result.modelRef,
      provider: result.provider,
      modelId: result.modelId,
      thinkingLevel: result.thinkingLevel,
      sessionId: result.sessionId,
      toolsUsed: result.toolsUsed,
      messageLog: result.messageLog,
      outputText: result.outputText,
      status: result.status,
      error: result.error ?? null,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
    },
  });
}
```

When building each `runtime.run()` input in `runScout`, `runImplement`, `runReview`, and `runProcess`, resolve once and pass config-driven metadata:

```ts
const selection = resolveConfiguredCasteModel(loadConfig(input.root), "titan");

const session = await input.runtime.run({
  caste: "titan",
  issueId: issue.id,
  root: input.root,
  workingDirectory: labor.laborPath,
  prompt: buildTitanPrompt(issue, labor.laborPath),
  modelRef: selection.reference,
  provider: selection.provider,
  modelId: selection.modelId,
  thinkingLevel: selection.thinkingLevel,
});
```

Persist transcript before caste artifact and include transcript ref inside caste artifact payload:

```ts
const transcriptRef = persistSessionTranscript(input.root, input.action, runInput, session);

const artifactRef = persistArtifact(input.root, {
  family: "titan",
  issueId: issue.id,
  artifact: {
    ...artifact,
    session: {
      transcriptRef,
      modelRef: session.modelRef,
      thinkingLevel: session.thinkingLevel,
      toolsUsed: session.toolsUsed,
    },
  },
});
```

- [ ] **Step 4: Run targeted tests to verify pass**

Run:

```bash
npm test -- tests/unit/runtime/create-caste-runtime.test.ts tests/unit/runtime/scripted-caste-runtime.test.ts tests/unit/core/artifact-store.test.ts tests/unit/core/caste-runner.test.ts
```

Expected:
- PASS
- transcript artifacts use unique `issue--caste` file names
- scripted runtime mirrors model/thinking structure without live tokens

- [ ] **Step 5: Commit**

```bash
git add src/runtime/caste-runtime.ts src/runtime/create-caste-runtime.ts src/runtime/pi-caste-runtime.ts src/runtime/scripted-caste-runtime.ts src/core/artifact-store.ts src/core/caste-runner.ts tests/unit/runtime/create-caste-runtime.test.ts tests/unit/runtime/scripted-caste-runtime.test.ts tests/unit/core/artifact-store.test.ts tests/unit/core/caste-runner.test.ts
git commit -m "feat: persist config-driven caste session metadata"
```

### Task 4: Make mock-run live-ready through config, not hardcoded provider/model assumptions

**Files:**
- Modify: `src/mock-run/seed-mock-run.ts`, `src/mock-run/todo-manifest.ts`, `tests/unit/mock-run/seed-mock-run.test.ts`
- Test: `tests/unit/mock-run/seed-mock-run.test.ts`

- [ ] **Step 1: Write failing tests for centralized live defaults and runtime option**

Replace current hardcoded gemma/google assertions in [tests/unit/mock-run/seed-mock-run.test.ts](/C:/dev/aegis/.worktrees/real-pi-proof-phases/tests/unit/mock-run/seed-mock-run.test.ts:7) with:

```ts
it("builds a live-ready mock-run config from central defaults", () => {
  const config = buildMockRunConfig();

  expect(config.runtime).toBe("pi");
  expect(config.models).toEqual(DEFAULT_AEGIS_CONFIG.models);
  expect(config.thinking).toEqual(DEFAULT_AEGIS_CONFIG.thinking);
  expect(config.labor.base_path).toBe("scratchpad");
});

it("allows explicit scripted fallback without changing model config", () => {
  const config = buildMockRunConfig({ runtime: "scripted", uncapped: false });

  expect(config.runtime).toBe("scripted");
  expect(config.models).toEqual(DEFAULT_AEGIS_CONFIG.models);
  expect(config.thinking).toEqual(DEFAULT_AEGIS_CONFIG.thinking);
});
```

- [ ] **Step 2: Run targeted tests to verify failure**

Run:

```bash
npm test -- tests/unit/mock-run/seed-mock-run.test.ts
```

Expected:
- FAIL because `buildMockRunConfig()` still hardcodes `scripted`, `google`, and `gemma`
- FAIL because config has no `thinking`

- [ ] **Step 3: Implement centralized mock-run config and project-local Pi settings**

Update `src/mock-run/seed-mock-run.ts`:

```ts
export function buildMockRunConfig(options?: {
  uncapped?: boolean;
  runtime?: "pi" | "scripted";
}) {
  const uncapped = options?.uncapped ?? true;
  const runtime = options?.runtime ?? "pi";

  const baseConfig = {
    ...DEFAULT_AEGIS_CONFIG,
    runtime,
    labor: {
      ...DEFAULT_AEGIS_CONFIG.labor,
      base_path: "scratchpad",
    },
  };

  return {
    ...baseConfig,
    concurrency: uncapped
      ? {
          max_agents: 10,
          max_oracles: 5,
          max_titans: 10,
          max_sentinels: 3,
          max_janus: 2,
        }
      : DEFAULT_AEGIS_CONFIG.concurrency,
  };
}
```

Update `src/mock-run/todo-manifest.ts` so project-local Pi settings stop hardcoding `google`/`gemma` and mirror config intent:

```ts
".pi/settings.json": JSON.stringify(
  {
    defaultProvider: "openai-codex",
    defaultModel: "gpt-5.4-mini",
    defaultThinkingLevel: "medium",
  },
  null,
  2,
),
```

Do not duplicate these strings anywhere else in mock-run seeding beyond central config/settings generation.

- [ ] **Step 4: Run targeted tests to verify pass**

Run:

```bash
npm test -- tests/unit/mock-run/seed-mock-run.test.ts
```

Expected:
- PASS
- mock-run can switch between `pi` and `scripted` without changing model map shape

- [ ] **Step 5: Commit**

```bash
git add src/mock-run/seed-mock-run.ts src/mock-run/todo-manifest.ts tests/unit/mock-run/seed-mock-run.test.ts
git commit -m "feat: seed mock-run from live pi defaults"
```

### Task 5: Full Phase H verification

**Files:**
- Modify: none if earlier tasks are complete
- Test: all touched suites plus repo-wide `npm test`

- [ ] **Step 1: Run focused deterministic verification suites**

Run:

```bash
npm test -- tests/unit/config/load-config.test.ts tests/integration/config/init-project.test.ts tests/unit/runtime/pi-model-config.test.ts tests/unit/cli/startup-preflight.test.ts tests/unit/cli/start.test.ts tests/unit/runtime/create-caste-runtime.test.ts tests/unit/runtime/scripted-caste-runtime.test.ts tests/unit/core/artifact-store.test.ts tests/unit/core/caste-runner.test.ts tests/unit/mock-run/seed-mock-run.test.ts
```

Expected:
- PASS
- no paid-model provider calls

- [ ] **Step 2: Run repo test suite**

Run:

```bash
npm test
```

Expected:
- PASS with all current unit/integration suites green

- [ ] **Step 3: Run non-token Phase H mock-run proof prep**

Run:

```bash
npm run build
npm run mock:seed
npm run mock:run -- node ../dist/index.js status
```

Expected:
- build succeeds
- seed succeeds with `.aegis/config.json` showing `runtime: "pi"` and config-driven `models` + `thinking`
- `status` prints clean observable state without invoking live model work

- [ ] **Step 4: Inspect proof artifacts shape without paying tokens**

Check these files exist and contain expected config structure:

```bash
type aegis-mock-run\\.aegis\\config.json
type aegis-mock-run\\.pi\\settings.json
```

Expected config fragments:

```json
{
  "runtime": "pi",
  "models": {
    "oracle": "openai-codex:gpt-5.4-mini"
  },
  "thinking": {
    "oracle": "medium"
  }
}
```

```json
{
  "defaultProvider": "openai-codex",
  "defaultModel": "gpt-5.4-mini",
  "defaultThinkingLevel": "medium"
}
```

- [ ] **Step 5: Confirm clean verification result**

Run:

```bash
git status --short
```

Expected:
- no unexpected files created by deterministic verification
- if files changed unexpectedly, stop and inspect before any final commit

---

## Self-Review

**Spec coverage**
- `thinking` config map: Task 1
- exact configured model refs, no `pi -> google` alias: Task 2
- config-driven Pi runtime wiring: Task 3
- transcript/session metadata observability: Task 3
- mock-run live-ready defaults without token-burning acceptance tests: Task 4 and Task 5

**Placeholder scan**
- No `TBD`, `TODO`, or “implement later” placeholders remain
- Each task has explicit files, commands, and concrete code snippets

**Type consistency**
- `CasteConfigKey` reused for `models`, `thinking`, and `CasteName`
- `AegisThinkingLevel` reused by config, runtime input, and runtime result
- `modelRef/provider/modelId/thinkingLevel` remain same property names across resolver, runtime, artifacts, and tests
