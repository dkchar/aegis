import { EventEmitter } from "node:events";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("S06 browser and stop runtime safeguards", () => {
  it("returns false instead of crashing when the browser launcher cannot spawn", async () => {
    vi.doMock("node:child_process", () => ({
      spawn: vi.fn(() => {
        const child = new EventEmitter() as EventEmitter & {
          unref: () => void;
          pid?: number;
        };

        child.pid = undefined;
        child.unref = vi.fn();
        setImmediate(() => {
          child.emit("error", Object.assign(new Error("spawn ENOENT"), {
            code: "ENOENT",
          }));
        });
        return child;
      }),
      spawnSync: vi.fn(),
    }));

    const startModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "cli", "start.ts")).href
    )) as {
      openBrowserUrl: (url: string) => boolean;
    };

    expect(startModule.openBrowserUrl("http://127.0.0.1:3847/")).toBe(false);
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  });

  it("keeps the stop contract timeout aligned with the runtime default", async () => {
    const stopModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "cli", "stop.ts")).href
    )) as {
      DEFAULT_STOP_GRACEFUL_TIMEOUT_MS: number;
      createStopCommandContract: () => {
        graceful_timeout_ms: number;
      };
    };

    expect(stopModule.createStopCommandContract().graceful_timeout_ms).toBe(
      stopModule.DEFAULT_STOP_GRACEFUL_TIMEOUT_MS,
    );
  });
});
