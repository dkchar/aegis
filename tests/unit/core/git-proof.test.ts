import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  captureGitProofPair,
  completeGitProofPair,
  hasOnlyAegisRootControlCommits,
  listOperationalDirtyFiles,
} from "../../../src/core/git-proof.js";

const tempRoots: string[] = [];

function createGitRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "aegis-git-proof-"));
  tempRoots.push(root);
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["config", "user.email", "test@aegis.local"], { cwd: root, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["config", "user.name", "Aegis Test"], { cwd: root, stdio: "ignore", windowsHide: true });
  writeFileSync(path.join(root, ".gitignore"), ".aegis/\n", "utf8");
  execFileSync("git", ["add", ".gitignore"], { cwd: root, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["commit", "-m", "baseline"], { cwd: root, stdio: "ignore", windowsHide: true });
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("git proof operational dirty files", () => {
  it("ignores Aegis-owned Agora state when checking root dirty files", () => {
    const root = createGitRoot();
    mkdirSync(path.join(root, ".agora"), { recursive: true });
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, ".agora", "tickets.json"), "{}\n", "utf8");
    writeFileSync(path.join(root, ".agora", "events.jsonl"), "{}\n", "utf8");
    writeFileSync(path.join(root, "src", "App.tsx"), "export function App() { return null; }\n", "utf8");

    const snapshot = captureGitProofPair(root).before;

    expect(listOperationalDirtyFiles(snapshot)).toEqual(["src/App.tsx"]);
  });

  it("identifies root drift made only by Aegis merge commits", () => {
    const root = createGitRoot();
    const proof = captureGitProofPair(root);
    execFileSync("git", ["checkout", "-b", "aegis/ISSUE-1"], { cwd: root, stdio: "ignore", windowsHide: true });
    writeFileSync(path.join(root, "candidate.txt"), "candidate\n", "utf8");
    execFileSync("git", ["add", "candidate.txt"], { cwd: root, stdio: "ignore", windowsHide: true });
    execFileSync("git", ["commit", "-m", "candidate"], { cwd: root, stdio: "ignore", windowsHide: true });
    execFileSync("git", ["checkout", "master"], { cwd: root, stdio: "ignore", windowsHide: true });
    execFileSync("git", ["merge", "--no-ff", "--no-edit", "aegis/ISSUE-1"], { cwd: root, stdio: "ignore", windowsHide: true });
    const completed = completeGitProofPair(root, proof);

    expect(hasOnlyAegisRootControlCommits(root, completed)).toBe(true);

    writeFileSync(path.join(root, "root.txt"), "root\n", "utf8");
    execFileSync("git", ["add", "root.txt"], { cwd: root, stdio: "ignore", windowsHide: true });
    execFileSync("git", ["commit", "-m", "root mutation"], { cwd: root, stdio: "ignore", windowsHide: true });

    expect(hasOnlyAegisRootControlCommits(root, completeGitProofPair(root, proof))).toBe(false);
  });

  it("identifies root drift made by another accepted Aegis issue commit", () => {
    const root = createGitRoot();
    const proof = captureGitProofPair(root);
    writeFileSync(path.join(root, "other-issue.txt"), "other\n", "utf8");
    execFileSync("git", ["add", "other-issue.txt"], { cwd: root, stdio: "ignore", windowsHide: true });
    execFileSync("git", ["commit", "-m", "AG-0029 add smoke verification tests"], {
      cwd: root,
      stdio: "ignore",
      windowsHide: true,
    });
    const completed = completeGitProofPair(root, proof);

    expect(hasOnlyAegisRootControlCommits(root, completed, "AG-0010")).toBe(true);
    expect(hasOnlyAegisRootControlCommits(root, completed, "AG-0029")).toBe(false);
  });
});
