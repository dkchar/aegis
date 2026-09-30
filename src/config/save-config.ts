import { writeJsonAtomic } from "../shared/atomic-write.js";
import { applyConfigPatch, loadConfig, resolveConfigPath } from "./load-config.js";
import type { AegisConfig } from "./schema.js";

export function saveConfig(root: string, config: AegisConfig): void {
  writeJsonAtomic(resolveConfigPath(root), config);
}

/** Validates a partial config patch against the current config and saves the result. */
export function updateConfig(root: string, patch: unknown): AegisConfig {
  const next = applyConfigPatch(loadConfig(root), patch);
  saveConfig(root, next);
  return next;
}
