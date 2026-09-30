import { describe, expect, it } from "vitest";

import {
  buildCliSpawnInvocation,
  findForbiddenWorkspaceProcess,
  isForbiddenLongRunningCommand,
  registerSessionProcess,
  terminateRegisteredSessionProcesses,
} from "../../../src/runtime/workspace-processes.js";

describe("workspace process supervision", () => {
  it("flags dev servers and watchers but not finite checks", () => {
    expect(isForbiddenLongRunningCommand("npm run dev")).toBe(true);
    expect(isForbiddenLongRunningCommand("pnpm.cmd preview")).toBe(true);
    expect(isForbiddenLongRunningCommand("vite --port 5173")).toBe(true);
    expect(isForbiddenLongRunningCommand("npx tsc --watch")).toBe(true);
    expect(isForbiddenLongRunningCommand("npm run build")).toBe(false);
    expect(isForbiddenLongRunningCommand("vitest run")).toBe(false);
  });

  it("finds forbidden servers in the workspace unless Playwright owns them", () => {
    const workspace = "/repo/.aegis/labors/AG-1";
    const snapshots = [
      { pid: 10, parentPid: 1, commandLine: "node /repo/.aegis/labors/AG-1/node_modules/.bin/playwright test" },
      { pid: 11, parentPid: 10, commandLine: "npm run dev --prefix /repo/.aegis/labors/AG-1" },
      { pid: 20, parentPid: 1, commandLine: "npm run dev --prefix /repo/.aegis/labors/AG-10" },
    ];
    expect(findForbiddenWorkspaceProcess(workspace, "linux", snapshots)).toBeNull();

    const rogue = [{ pid: 30, parentPid: 1, commandLine: "npm run dev --prefix /repo/.aegis/labors/AG-1" }];
    expect(findForbiddenWorkspaceProcess(workspace, "linux", rogue)).toBe(rogue[0]!.commandLine);
  });

  it("builds Windows launchers for npm shims and explicit executables", () => {
    expect(buildCliSpawnInvocation("codex", ["exec"], "win32").args.at(-1)).toBe("& 'codex.cmd' 'exec'; exit $LASTEXITCODE");
    expect(buildCliSpawnInvocation("tool.exe", ["it's"], "win32").args.at(-1)).toBe("& 'tool.exe' 'it''s'; exit $LASTEXITCODE");
    expect(buildCliSpawnInvocation("codex", ["exec"], "darwin")).toEqual({ command: "codex", args: ["exec"] });
  });

  it("tracks registered session processes per workspace", () => {
    const unregister = registerSessionProcess("/repo/.aegis/labors/AG-2", 999_999_001);
    unregister();
    expect(terminateRegisteredSessionProcesses("/repo/.aegis/labors/AG-2")).toBe(0);
  });
});
