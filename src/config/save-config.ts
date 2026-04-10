import { renameSync, unlinkSync, writeFileSync } from "node:fs";

import { applyConfigPatch, loadConfig, resolveConfigPath } from "./load-config.js";
import type { AegisConfig } from "./schema.js";

function buildTempConfigPath(configPath: string) {
  return `${configPath}.tmp-${process.pid}-${Date.now()}`;
}

export function saveConfig(root: string, config: AegisConfig): void {
  const configPath = resolveConfigPath(root);
  const tempPath = buildTempConfigPath(configPath);
  const payload = `${JSON.stringify(config, null, 2)}\n`;

  try {
    writeFileSync(tempPath, payload, "utf8");
    renameSync(tempPath, configPath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Best effort cleanup only.
    }
    throw error;
  }
}

export function updateConfig(root: string, patch: unknown): AegisConfig {
  const current = loadConfig(root);
  const next = applyConfigPatch(current, patch);
  saveConfig(root, next);
  return next;
}
