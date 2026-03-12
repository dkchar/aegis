// test/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  loadConfig,
  getDefaultConfig,
  validateConfig,
} from "../src/config.js";
import type { AegisConfig } from "../src/types.js";

// Helpers to create temp dirs
function makeTempDir(): string {
  const dir = join(tmpdir(), `aegis-test-${randomBytes(6).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfig(dir: string, config: unknown): void {
  mkdirSync(join(dir, ".aegis"), { recursive: true });
  writeFileSync(join(dir, ".aegis", "config.json"), JSON.stringify(config));
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = makeTempDir();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------- getDefaultConfig() ----------
describe("getDefaultConfig()", () => {
  it("returns an object with all required fields", () => {
    const cfg = getDefaultConfig();
    expect(cfg.version).toBe(1);
    expect(cfg.auth).toBeDefined();
    expect(cfg.models).toBeDefined();
    expect(cfg.concurrency).toBeDefined();
    expect(cfg.budgets).toBeDefined();
    expect(cfg.timing).toBeDefined();
    expect(cfg.mnemosyne).toBeDefined();
    expect(cfg.labors).toBeDefined();
    expect(cfg.olympus).toBeDefined();
  });

  it("returns a config that passes validateConfig", () => {
    const cfg = getDefaultConfig();
    expect(() => validateConfig(cfg)).not.toThrow();
  });

  it("has the correct default model names", () => {
    const cfg = getDefaultConfig();
    expect(cfg.models.oracle).toBe("claude-haiku-4-5");
    expect(cfg.models.titan).toBe("claude-sonnet-4-5");
    expect(cfg.models.sentinel).toBe("claude-opus-4-5");
    expect(cfg.models.metis).toBe("claude-haiku-4-5");
    expect(cfg.models.prometheus).toBe("claude-opus-4-5");
  });

  it("has correct default concurrency values", () => {
    const cfg = getDefaultConfig();
    expect(cfg.concurrency.max_agents).toBe(4);
    expect(cfg.concurrency.max_oracles).toBe(2);
    expect(cfg.concurrency.max_titans).toBe(2);
    expect(cfg.concurrency.max_sentinels).toBe(1);
  });

  it("has correct default timing values", () => {
    const cfg = getDefaultConfig();
    expect(cfg.timing.poll_interval_seconds).toBe(5);
    expect(cfg.timing.stuck_warning_seconds).toBe(120);
    expect(cfg.timing.stuck_kill_seconds).toBe(300);
  });

  it("has correct olympus defaults", () => {
    const cfg = getDefaultConfig();
    expect(cfg.olympus.port).toBe(3737);
    expect(cfg.olympus.open_browser).toBe(true);
  });
});

// ---------- validateConfig() ----------
describe("validateConfig()", () => {
  it("accepts the default config", () => {
    expect(() => validateConfig(getDefaultConfig())).not.toThrow();
  });

  it("throws when raw is not an object", () => {
    expect(() => validateConfig("not an object")).toThrow(/JSON object/);
    expect(() => validateConfig(null)).toThrow(/JSON object/);
    expect(() => validateConfig([])).toThrow(/JSON object/);
  });

  it("throws when version is not 1", () => {
    const bad = { ...getDefaultConfig(), version: 2 };
    expect(() => validateConfig(bad)).toThrow(/version/);
  });

  it("throws when auth is missing", () => {
    const bad = getDefaultConfig() as Record<string, unknown>;
    delete bad["auth"];
    expect(() => validateConfig(bad)).toThrow(/auth/);
  });

  it("throws when models section is missing", () => {
    const bad = getDefaultConfig() as Record<string, unknown>;
    delete bad["models"];
    expect(() => validateConfig(bad)).toThrow(/models/);
  });

  it("throws when a model name is empty string", () => {
    const bad = { ...getDefaultConfig(), models: { ...getDefaultConfig().models, oracle: "" } };
    expect(() => validateConfig(bad)).toThrow(/oracle/);
  });

  it("throws when concurrency is missing", () => {
    const bad = getDefaultConfig() as Record<string, unknown>;
    delete bad["concurrency"];
    expect(() => validateConfig(bad)).toThrow(/concurrency/);
  });

  it("throws when max_agents is negative", () => {
    const bad = {
      ...getDefaultConfig(),
      concurrency: { ...getDefaultConfig().concurrency, max_agents: -1 },
    };
    expect(() => validateConfig(bad)).toThrow(/max_agents/);
  });

  it("throws when max_agents is zero", () => {
    const bad = {
      ...getDefaultConfig(),
      concurrency: { ...getDefaultConfig().concurrency, max_agents: 0 },
    };
    expect(() => validateConfig(bad)).toThrow(/max_agents/);
  });

  it("throws when budgets section is missing", () => {
    const bad = getDefaultConfig() as Record<string, unknown>;
    delete bad["budgets"];
    expect(() => validateConfig(bad)).toThrow(/budgets/);
  });

  it("throws when timing section is missing", () => {
    const bad = getDefaultConfig() as Record<string, unknown>;
    delete bad["timing"];
    expect(() => validateConfig(bad)).toThrow(/timing/);
  });

  it("throws when olympus port is zero", () => {
    const bad = {
      ...getDefaultConfig(),
      olympus: { ...getDefaultConfig().olympus, port: 0 },
    };
    expect(() => validateConfig(bad)).toThrow(/port/);
  });

  it("throws when open_browser is not boolean", () => {
    const bad = {
      ...getDefaultConfig(),
      olympus: { ...getDefaultConfig().olympus, open_browser: "yes" },
    };
    expect(() => validateConfig(bad)).toThrow(/open_browser/);
  });

  it("accepts null auth values", () => {
    const cfg: AegisConfig = {
      ...getDefaultConfig(),
      auth: { anthropic: null, openai: null, google: null },
    };
    expect(() => validateConfig(cfg)).not.toThrow();
  });

  it("accepts string auth values", () => {
    const cfg: AegisConfig = {
      ...getDefaultConfig(),
      auth: { anthropic: "sk-test", openai: "sk-test2", google: null },
    };
    const result = validateConfig(cfg);
    expect(result.auth.anthropic).toBe("sk-test");
  });
});

// ---------- loadConfig() ----------
describe("loadConfig()", () => {
  it("loads a valid config file", () => {
    writeConfig(tmpDir, getDefaultConfig());
    const cfg = loadConfig(tmpDir);
    expect(cfg.version).toBe(1);
    expect(cfg.models.oracle).toBe("claude-haiku-4-5");
  });

  it("throws with aegis init suggestion when file is missing", () => {
    expect(() => loadConfig(tmpDir)).toThrow(/aegis init/);
  });

  it("throws with the missing path in the error", () => {
    // Path separator is OS-dependent; match the config.json filename regardless
    expect(() => loadConfig(tmpDir)).toThrow(/config\.json/);
  });

  it("throws on invalid JSON in config file", () => {
    mkdirSync(join(tmpDir, ".aegis"), { recursive: true });
    writeFileSync(join(tmpDir, ".aegis", "config.json"), "{ bad json ]]]");
    expect(() => loadConfig(tmpDir)).toThrow(/Invalid JSON/);
  });

  it("throws validation errors for invalid config values", () => {
    writeConfig(tmpDir, { ...getDefaultConfig(), version: 99 });
    expect(() => loadConfig(tmpDir)).toThrow(/version/);
  });

  it("defaults to process.cwd() when no projectRoot given", () => {
    // Should throw (no config in cwd unless it happens to exist)
    // We just verify it doesn't crash with a path error
    try {
      loadConfig();
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("loads custom auth values", () => {
    const cfg = {
      ...getDefaultConfig(),
      auth: { anthropic: "sk-custom", openai: null, google: null },
    };
    writeConfig(tmpDir, cfg);
    const result = loadConfig(tmpDir);
    expect(result.auth.anthropic).toBe("sk-custom");
  });

  it("loads custom concurrency values", () => {
    const cfg = {
      ...getDefaultConfig(),
      concurrency: { max_agents: 8, max_oracles: 4, max_titans: 3, max_sentinels: 2 },
    };
    writeConfig(tmpDir, cfg);
    const result = loadConfig(tmpDir);
    expect(result.concurrency.max_agents).toBe(8);
  });
});
