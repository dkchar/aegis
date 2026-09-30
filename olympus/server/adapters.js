import { homedir } from "node:os";
import path from "node:path";
import { readJson } from "./io.js";

// Live runtime adapters an operator can select in Olympus. The scripted seam
// runtime stays terminal-only.
export const LIVE_ADAPTERS = ["claude", "codex", "pi"];

const MODEL_CACHE_TTL_MS = 60_000;
const modelCache = new Map();

// Claude Code accepts full model ids; keep this list to current models.
const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", note: "default" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  { id: "claude-fable-5-1", name: "Claude Fable 5.1" },
];

function listClaudeModelOptions() {
  const options = CLAUDE_MODELS.map((model) => ({
    provider: "anthropic",
    id: model.id,
    value: `anthropic:${model.id}`,
    label: `Claude Code / ${model.name}${model.note ? ` (${model.note})` : ""}`,
  }));
  return { options, providers: ["anthropic"], message: "" };
}

function readCodexModelOptions() {
  const cachePath = path.join(homedir(), ".codex", "models_cache.json");
  const cache = readJson(cachePath, null);
  const models = Array.isArray(cache?.models) ? cache.models : [];
  const options = models
    .filter((model) => typeof model?.slug === "string" && model.visibility !== "hidden")
    .map((model) => ({
      provider: "openai-codex",
      id: model.slug,
      value: `openai-codex:${model.slug}`,
      label: `Codex / ${model.display_name ?? model.slug}`,
      reasoning: model.default_reasoning_level ?? "medium",
    }))
    .sort((left, right) => {
      const leftMini = /mini|small|spark/i.test(left.id) ? 0 : 1;
      const rightMini = /mini|small|spark/i.test(right.id) ? 0 : 1;
      return leftMini - rightMini || left.label.localeCompare(right.label);
    });
  return {
    options,
    providers: options.length ? ["openai-codex"] : [],
    message: options.length ? "" : "Run Codex once so local model availability can be cached.",
  };
}

async function readPiModelOptions() {
  try {
    const { getModels, getProviders } = await import("@mariozechner/pi-ai");
    const providers = getProviders().sort();
    return {
      providers,
      options: providers
        .flatMap((provider) => getModels(provider).map((model) => ({
          provider,
          id: model.id,
          value: `${provider}:${model.id}`,
          label: `${provider} / ${model.name ?? model.id}`,
        })))
        .sort((left, right) => left.label.localeCompare(right.label)),
      message: providers.length ? "" : "No Pi model providers are exposed by the runtime registry.",
    };
  } catch (error) {
    return {
      options: [],
      providers: [],
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function loadModelOptions(adapter) {
  if (adapter === "claude") return listClaudeModelOptions();
  if (adapter === "codex") return readCodexModelOptions();
  if (adapter === "pi") return readPiModelOptions();
  return { options: [], providers: [], message: "No authenticated model registry is exposed for this adapter yet." };
}

/** Model choices per adapter, cached briefly because the SSE stream asks every tick. */
export async function listModelOptions(_root, adapter) {
  const cached = modelCache.get(adapter);
  if (cached && Date.now() - cached.at < MODEL_CACHE_TTL_MS) return cached.value;
  const value = await loadModelOptions(adapter);
  modelCache.set(adapter, { at: Date.now(), value });
  return value;
}
