import { describe, expect, it } from "vitest";

import { CASTE_CONFIG_KEYS } from "../../../src/config/caste-config.js";
import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";
import { CONFIG_TOP_LEVEL_KEYS } from "../../../src/config/schema.js";
import {
  buildMockRunConfig,
  MOCK_RUN_LABOR_BASE_PATH,
} from "../../../src/mock-run/seed-mock-run.js";

describe("buildMockRunConfig", () => {
  it("builds a deterministic proof mock-run config from central defaults", () => {
    const config = buildMockRunConfig();

    expect(Object.keys(config)).toEqual(CONFIG_TOP_LEVEL_KEYS);
    expect(config.runtime).toBe("scripted");
    for (const caste of CASTE_CONFIG_KEYS) {
      expect(config.models[caste]).toBe("openai-codex:gpt-5.4-mini");
      expect(config.thinking[caste]).toBe("medium");
    }
    expect(config.labor.base_path).toBe(MOCK_RUN_LABOR_BASE_PATH);
    expect(config.concurrency).toEqual({
      max_agents: 10,
      max_oracles: 5,
      max_titans: 10,
      max_sentinels: 3,
      max_janus: 2,
    });
    expect(config.thresholds.stuck_warning_seconds).toBe(240);
    expect(config.thresholds.stuck_kill_seconds).toBe(600);
    expect(config).not.toHaveProperty("olympus");
    expect(config).not.toHaveProperty("budgets");
    expect(config).not.toHaveProperty("economics");
  });

  it("allows explicit pi override without changing model config", () => {
    const config = buildMockRunConfig({ runtime: "pi", uncapped: false });

    expect(Object.keys(config)).toEqual(CONFIG_TOP_LEVEL_KEYS);
    expect(config.runtime).toBe("pi");
    for (const caste of CASTE_CONFIG_KEYS) {
      expect(config.models[caste]).toBe("openai-codex:gpt-5.4-mini");
      expect(config.thinking[caste]).toBe("medium");
    }
    expect(config.labor.base_path).toBe(MOCK_RUN_LABOR_BASE_PATH);
    expect(config.concurrency).toEqual(DEFAULT_AEGIS_CONFIG.concurrency);
    expect(config.thresholds.stuck_warning_seconds).toBe(240);
    expect(config.thresholds.stuck_kill_seconds).toBe(600);
  });
});
