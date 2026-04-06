import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { initProject } from "../../../src/config/init-project.js";
import { runCli } from "../../../src/index.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const temporaryRoots: string[] = [];

function createTempRepo() {
  const tempRepo = mkdtempSync(path.join(tmpdir(), "aegis-s07-cli-"));
  temporaryRoots.push(tempRepo);
  return tempRepo;
}

function initializeGitRepo(root: string) {
  const gitInit = spawnSync("git", ["init"], {
    cwd: root,
    encoding: "utf8",
  });
  expect(gitInit.status, gitInit.stderr).toBe(0);
}

function captureConsole(fn: () => Promise<void>) {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;

  console.log = (...args) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args) => {
    errors.push(args.map(String).join(" "));
  };

  return fn().finally(() => {
    console.log = origLog;
    console.error = origError;
  }).then(() => ({ logs, errors }));
}

afterEach(() => {
  for (const tempRoot of temporaryRoots.splice(0)) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("S07 direct CLI command routing", () => {
  it("routes a declined command (scout) and prints the decline reason", async () => {
    const tempRepo = createTempRepo();
    initProject(tempRepo);
    initializeGitRepo(tempRepo);

    const { logs } = await captureConsole(async () => {
      await runCli(tempRepo, ["scout", "aegis-fjm.8.2"]);
    });

    expect(logs.some((l) => l.includes("declined"))).toBe(true);
    expect(logs.some((l) => l.includes("scout dispatch requires S08 (Oracle)"))).toBe(true);
  });

  it("routes a handled command (focus) and prints acknowledged", async () => {
    const tempRepo = createTempRepo();
    initProject(tempRepo);
    initializeGitRepo(tempRepo);

    const { logs } = await captureConsole(async () => {
      await runCli(tempRepo, ["focus"]);
    });

    expect(logs.some((l) => l.includes("acknowledged"))).toBe(true);
  });

  it("routes a handled command (pause) and prints acknowledged", async () => {
    const tempRepo = createTempRepo();
    initProject(tempRepo);
    initializeGitRepo(tempRepo);

    const { logs } = await captureConsole(async () => {
      await runCli(tempRepo, ["pause"]);
    });

    expect(logs.some((l) => l.includes("acknowledged"))).toBe(true);
  });

  it("reports unsupported for unrecognized commands", async () => {
    const tempRepo = createTempRepo();
    initProject(tempRepo);
    initializeGitRepo(tempRepo);

    const { errors } = await captureConsole(async () => {
      await runCli(tempRepo, ["foobar"]);
    });

    expect(errors.some((e) => e.includes("Unsupported direct command"))).toBe(true);
  });

  it("routes implement command as declined", async () => {
    const tempRepo = createTempRepo();
    initProject(tempRepo);
    initializeGitRepo(tempRepo);

    const { logs } = await captureConsole(async () => {
      await runCli(tempRepo, ["implement", "aegis-fjm.9.1"]);
    });

    expect(logs.some((l) => l.includes("declined"))).toBe(true);
    expect(logs.some((l) => l.includes("Titan"))).toBe(true);
  });

  it("routes review command as declined", async () => {
    const tempRepo = createTempRepo();
    initProject(tempRepo);
    initializeGitRepo(tempRepo);

    const { logs } = await captureConsole(async () => {
      await runCli(tempRepo, ["review", "aegis-fjm.10.3"]);
    });

    expect(logs.some((l) => l.includes("declined"))).toBe(true);
    expect(logs.some((l) => l.includes("Sentinel"))).toBe(true);
  });
});
