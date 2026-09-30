import path from "node:path";

import { writeJsonAtomic } from "../shared/atomic-write.js";

export type ArtifactFamily = "oracle" | "titan" | "sentinel" | "janus" | "transcripts";

export interface PersistArtifactInput {
  family: ArtifactFamily;
  issueId: string;
  artifactId?: string;
  artifact: unknown;
}

export function buildArtifactRef(family: ArtifactFamily, issueId: string, artifactId?: string) {
  const fileName = artifactId ? `${issueId}--${artifactId}.json` : `${issueId}.json`;
  return path.join(".aegis", family, fileName);
}

/** Writes an artifact under `.aegis/<family>/` and returns its project-relative ref. */
export function persistArtifact(root: string, input: PersistArtifactInput) {
  const ref = buildArtifactRef(input.family, input.issueId, input.artifactId);
  writeJsonAtomic(path.join(path.resolve(root), ref), input.artifact);
  return ref;
}
