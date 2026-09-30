import { normalizeScopeFile } from "../shared/file-scope.js";

/**
 * Text markers Aegis writes into prompts and tracker descriptions, and the
 * parsers that read them back. Keeping writer and reader together prevents the
 * formats from drifting apart.
 */

/** Prompt line listing the files a caste may touch. */
export const ALLOWED_FILE_SCOPE_PREFIX = "Allowed file scope:";

/** Issue description line declaring owned files (seeded graphs, operators). */
export const DECLARED_FILE_OWNERSHIP_PREFIX = "Aegis file ownership:";

/** Lines Aegis policy writes into descriptions of policy-created blocker issues. */
export const POLICY_PROPOSAL_MARKER = "Policy proposal:";
export const POLICY_FINGERPRINT_MARKER = "Fingerprint:";
export const POLICY_SCOPE_EVIDENCE_MARKER = "Scope evidence:";

function extractCommaSeparatedLine(text: string, prefix: string) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}\\s*(.+)$`, "im").exec(text);
  if (!match) {
    return [];
  }

  return match[1]!
    .split(",")
    .map((entry) => normalizeScopeFile(entry))
    .filter((entry) => entry.length > 0);
}

export function extractAllowedFileScope(prompt: string): string[] {
  return extractCommaSeparatedLine(prompt, ALLOWED_FILE_SCOPE_PREFIX);
}

export function extractDeclaredFileScope(description: string | null | undefined): string[] {
  return extractCommaSeparatedLine(description ?? "", DECLARED_FILE_OWNERSHIP_PREFIX);
}

/** True for tracker issues created by Aegis mutation policy (see control-plane-policy). */
export function isPolicyCreatedBlockerDescription(description: string | null | undefined) {
  return typeof description === "string"
    && description.includes(POLICY_PROPOSAL_MARKER)
    && description.includes(POLICY_FINGERPRINT_MARKER)
    && description.includes(POLICY_SCOPE_EVIDENCE_MARKER);
}
