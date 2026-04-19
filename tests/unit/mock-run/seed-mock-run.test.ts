import { describe, expect, it } from "vitest";

import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";
import { CONFIG_TOP_LEVEL_KEYS } from "../../../src/config/schema.js";
import {
  buildMockRunConfig,
  MOCK_RUN_LABOR_BASE_PATH,
} from "../../../src/mock-run/seed-mock-run.js";

describe("buildMockRunConfig", () => {
  it("builds a live-ready mock-run config from central defaults", () => {
    const config = buildMockRunConfig();

    expect(Object.keys(config)).toEqual(CONFIG_TOP_LEVEL_KEYS);
    expect(config.runtime).toBe("pi");
    expect(config.models).toEqual(DEFAULT_AEGIS_CONFIG.models);
    expect(config.thinking).toEqual(DEFAULT_AEGIS_CONFIG.thinking);
    expect(config.labor.base_path).toBe(MOCK_RUN_LABOR_BASE_PATH);
    expect(config.concurrency).toEqual({
      max_agents: 10,
      max_oracles: 5,
      max_titans: 10,
      max_sentinels: 3,
      max_janus: 2,
    });
    expect(config).not.toHaveProperty("olympus");
    expect(config).not.toHaveProperty("budgets");
    expect(config).not.toHaveProperty("economics");
  });

  it("allows explicit scripted fallback without changing model config", () => {
    const config = buildMockRunConfig({ runtime: "scripted", uncapped: false });

    expect(Object.keys(config)).toEqual(CONFIG_TOP_LEVEL_KEYS);
    expect(config.runtime).toBe("scripted");
    expect(config.models).toEqual(DEFAULT_AEGIS_CONFIG.models);
    expect(config.thinking).toEqual(DEFAULT_AEGIS_CONFIG.thinking);
    expect(config.labor.base_path).toBe(MOCK_RUN_LABOR_BASE_PATH);
    expect(config.concurrency).toEqual(DEFAULT_AEGIS_CONFIG.concurrency);
  });
});
