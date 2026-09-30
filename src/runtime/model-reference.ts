import type { AegisThinkingLevel } from "../config/schema.js";

export interface ParsedModelConfig {
  reference: string;
  provider: string;
  modelId: string;
  thinkingLevel: AegisThinkingLevel;
}

/**
 * Splits a configured `<provider>:<model-id>` reference.
 *
 * A bare model id (no separator) is accepted when the adapter has an implied
 * provider; otherwise the provider and model are reported as `unknown`.
 */
export function parseModelReference(
  reference: string,
  thinkingLevel: AegisThinkingLevel,
  defaultProvider?: string,
): ParsedModelConfig {
  const separator = reference.indexOf(":");
  if (separator > 0 && separator < reference.length - 1) {
    return {
      reference,
      provider: reference.slice(0, separator),
      modelId: reference.slice(separator + 1),
      thinkingLevel,
    };
  }

  if (separator === -1 && defaultProvider && reference.trim().length > 0) {
    return {
      reference,
      provider: defaultProvider,
      modelId: reference.trim(),
      thinkingLevel,
    };
  }

  return {
    reference,
    provider: "unknown",
    modelId: "unknown",
    thinkingLevel,
  };
}

/** Keeps the tail of long adapter output so errors stay readable in state files. */
export function tailText(text: string, maxChars = 8_000) {
  const trimmed = text.trim();
  return trimmed.length > maxChars
    ? `...[truncated ${trimmed.length - maxChars} chars]\n${trimmed.slice(-maxChars)}`
    : trimmed;
}
