import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_GITIGNORE_ENTRIES, initProject } from "../../../src/config/init-project.js";
import { loadConfig } from "../../../src/config/load-config.js";
import { parseInitOptions } from "../../../src/index.js";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-init-unit-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("initProject", () => {
  it("ignores all durable generated Aegis artifact directories", () => {
    expect(DEFAULT_GITIGNORE_ENTRIES).toContain(".aegis/policy/");
    expect(DEFAULT_GITIGNORE_ENTRIES).toContain(".aegis/final-app-verification.json");
  });

  it("seeds a live adapter config with that adapter's default models", () => {
    const root = createTempRoot();

    const result = initProject(root, { runtime: "claude" });

    expect(result.seededConfig).toBe(true);
    expect(loadConfig(root)).toMatchObject({
      runtime: "claude",
      models: { oracle: "anthropic:claude-opus-5-5", titan: "anthropic:claude-opus-5-5" },
    });
    expect(loadConfig(root).thresholds.stuck_kill_seconds).toBeGreaterThan(0);
  });

  it("never rewrites an existing config", () => {
    const root = createTempRoot();
    initProject(root, { runtime: "codex" });

    const second = initProject(root, { runtime: "claude" });

    expect(second.seededConfig).toBe(false);
    expect(loadConfig(root).runtime).toBe("codex");
  });
});

describe("parseInitOptions", () => {
  it("accepts --runtime in both flag forms", () => {
    expect(parseInitOptions([])).toEqual({});
    expect(parseInitOptions(["--runtime", "claude"])).toEqual({ runtime: "claude" });
    expect(parseInitOptions(["--runtime=pi"])).toEqual({ runtime: "pi" });
  });

  it("rejects unknown adapters and stray arguments", () => {
    expect(() => parseInitOptions(["--runtime", "gemini"])).toThrow(/Unsupported runtime adapter: gemini/);
    expect(() => parseInitOptions(["--runtime"])).toThrow(/Usage: aegis init/);
    expect(() => parseInitOptions(["--force"])).toThrow(/Usage: aegis init/);
    expect(() => parseInitOptions(["--runtime=codex", "extra"])).toThrow(/Usage: aegis init/);
  });
});
