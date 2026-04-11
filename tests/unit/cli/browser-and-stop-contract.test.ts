import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { initProject } from "../../../src/config/init-project.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const temporaryRoots: string[] = [];

function createTempRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-start-preflight-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();

  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
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

  it("prints the preflight report and does not open the browser when startup preflight is blocked", async () => {
    const tempRepo = createTempRepo();
    initProject(tempRepo);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const openBrowser = vi.fn(() => true);
    const verifyTracker = vi.fn(() => {
      throw new Error("Beads tracker is not initialized or healthy for this repository.");
    });

    const startModule = (await import(
      pathToFileURL(path.join(repoRoot, "src", "cli", "start.ts")).href
    )) as {
      startAegis: (
        root?: string,
        overrides?: {
          port?: number;
          noBrowser?: boolean;
        },
        options?: {
          verifyTracker?: (root: string) => void;
          verifyGitRepo?: () => void;
          openBrowser?: (url: string) => boolean;
          registerSignalHandlers?: boolean;
        },
      ) => Promise<unknown>;
    };

    const blockedError = await startModule.startAegis(
      tempRepo,
      {},
      {
        verifyTracker,
        verifyGitRepo: () => undefined,
        openBrowser,
        registerSignalHandlers: false,
      },
    ).catch((error: unknown) => error);

    expect(blockedError).toBeInstanceOf(Error);
    expect(blockedError).toMatchObject({
      message: "Aegis startup preflight blocked.",
      report: expect.objectContaining({
        overall: "blocked",
        repoRoot: tempRepo,
      }),
    });
    expect(openBrowser).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Aegis startup preflight: blocked"),
    );
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
