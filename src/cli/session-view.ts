import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export interface RunningSessionView {
  issueId: string;
  caste: string;
  sessionId: string;
}

export interface SessionViewTracker {
  sync(runningSessions: RunningSessionView[]): void;
  stop(): void;
}

export interface SessionViewTrackerOptions {
  spawnProcess?: typeof spawn;
  cliEntrypoint?: string;
  platform?: NodeJS.Platform;
  onLaunchError?: (message: string) => void;
}

function resolveCliEntrypoint(root: string, override?: string) {
  if (override) {
    return path.resolve(override);
  }

  const distCandidate = path.join(path.resolve(root), "dist", "index.js");
  if (existsSync(distCandidate)) {
    return distCandidate;
  }

  const sourceCandidate = path.join(path.resolve(root), "src", "index.ts");
  if (existsSync(sourceCandidate)) {
    return sourceCandidate;
  }

  return process.argv[1] ? path.resolve(process.argv[1]) : distCandidate;
}

function launchSessionViewer(
  root: string,
  sessionId: string,
  options: SessionViewTrackerOptions,
) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return;
  }

  const entrypoint = resolveCliEntrypoint(root, options.cliEntrypoint);
  const streamCommand = `"${process.execPath}" "${entrypoint}" stream session "${sessionId}"`;
  const spawnProcess = options.spawnProcess ?? spawn;
  const spawnOptions: SpawnOptions = {
    cwd: path.resolve(root),
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  };

  const child = spawnProcess(
    process.env.ComSpec ?? "cmd.exe",
    ["/d", "/c", "start", "", "cmd.exe", "/d", "/s", "/c", streamCommand],
    spawnOptions,
  );
  if (typeof (child as ChildProcess).unref === "function") {
    child.unref();
  }
}

export function createSessionViewTracker(
  root: string,
  options: SessionViewTrackerOptions = {},
): SessionViewTracker {
  const activeSessionIds = new Set<string>();

  return {
    sync(runningSessions: RunningSessionView[]) {
      const nextSessionIds = new Set(runningSessions.map((session) => session.sessionId));

      for (const session of runningSessions) {
        if (activeSessionIds.has(session.sessionId)) {
          continue;
        }

        try {
          launchSessionViewer(root, session.sessionId, options);
          activeSessionIds.add(session.sessionId);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          options.onLaunchError?.(
            `Failed to launch session viewer for ${session.sessionId}: ${detail}`,
          );
        }
      }

      for (const sessionId of [...activeSessionIds]) {
        if (!nextSessionIds.has(sessionId)) {
          activeSessionIds.delete(sessionId);
        }
      }
    },

    stop() {
      activeSessionIds.clear();
    },
  };
}
