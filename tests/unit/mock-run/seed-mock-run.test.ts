import { describe, expect, it } from "vitest";

import { DEFAULT_AEGIS_CONFIG } from "../../../src/config/defaults.js";
import { CONFIG_TOP_LEVEL_KEYS } from "../../../src/config/schema.js";
import { buildMockRunConfig } from "../../../src/mock-run/seed-mock-run.js";

describe("buildMockRunConfig", () => {
  it("keeps mock-run config within the stripped MVP schema", () => {
    const config = buildMockRunConfig();

    expect(Object.keys(config)).toEqual(CONFIG_TOP_LEVEL_KEYS);
    expect(config.runtime).toBe("phase_d_shell");
    expect(config.models).toEqual({
      ...DEFAULT_AEGIS_CONFIG.models,
      oracle: "pi:gemma-4-31b-it",
      titan: "pi:gemma-4-31b-it",
      sentinel: "pi:gemma-4-31b-it",
    });
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

  it("uses the same stripped config domains for bounded mock runs", () => {
    const config = buildMockRunConfig({ uncapped: false });

    expect(Object.keys(config)).toEqual(CONFIG_TOP_LEVEL_KEYS);
    expect(config.runtime).toBe("phase_d_shell");
    expect(config.concurrency).toEqual(DEFAULT_AEGIS_CONFIG.concurrency);
  });
});
