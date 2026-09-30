/**
 * Single source of truth for runtime adapter names and per-adapter policy.
 *
 * - `scripted`: deterministic seam runtime for tests and mock acceptance.
 * - `pi`: in-process Pi coding agent; artifacts arrive through typed tools.
 * - `codex`: `codex exec` CLI; artifacts arrive as final JSON text.
 * - `claude`: Claude Code headless CLI (`claude -p`); artifacts arrive as final JSON text.
 */
export const RUNTIME_ADAPTER_NAMES = ["scripted", "pi", "codex", "claude"] as const;

export type RuntimeAdapterName = (typeof RUNTIME_ADAPTER_NAMES)[number];

/** Adapters backed by a real model (everything except the scripted seam runtime). */
export const LIVE_RUNTIME_ADAPTER_NAMES = ["pi", "codex", "claude"] as const satisfies readonly RuntimeAdapterName[];

export type LiveRuntimeAdapterName = (typeof LIVE_RUNTIME_ADAPTER_NAMES)[number];

export type ArtifactEmissionMode = "tool" | "json";

export function isRuntimeAdapterName(value: unknown): value is RuntimeAdapterName {
  return typeof value === "string" && (RUNTIME_ADAPTER_NAMES as readonly string[]).includes(value);
}

export function isLiveRuntimeAdapterName(value: unknown): value is LiveRuntimeAdapterName {
  return typeof value === "string" && (LIVE_RUNTIME_ADAPTER_NAMES as readonly string[]).includes(value);
}

/**
 * How a caste session hands its final artifact back to Aegis. Pi registers a
 * typed `emit_*` tool per caste; CLI adapters return the artifact as JSON text.
 */
export function resolveArtifactEmissionMode(runtime: string): ArtifactEmissionMode {
  return runtime === "pi" ? "tool" : "json";
}

export function assertRuntimeAdapterName(value: string): RuntimeAdapterName {
  if (!isRuntimeAdapterName(value)) {
    throw new Error(
      `Unsupported runtime adapter: ${value}. Expected one of ${RUNTIME_ADAPTER_NAMES.join(", ")}.`,
    );
  }
  return value;
}
