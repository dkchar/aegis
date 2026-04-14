import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface PersistArtifactInput {
  family: "oracle" | "titan" | "sentinel" | "janus" | "transcripts";
  issueId: string;
  artifact: unknown;
}

function resolveArtifactPath(root: string, family: PersistArtifactInput["family"], issueId: string) {
  return path.join(path.resolve(root), ".aegis", family, `${issueId}.json`);
}

export function persistArtifact(root: string, input: PersistArtifactInput) {
  const artifactPath = resolveArtifactPath(root, input.family, input.issueId);
  const temporaryPath = `${artifactPath}.tmp`;

  mkdirSync(path.dirname(artifactPath), { recursive: true });
  writeFileSync(temporaryPath, `${JSON.stringify(input.artifact, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, artifactPath);

  return path.join(".aegis", input.family, `${input.issueId}.json`);
}
