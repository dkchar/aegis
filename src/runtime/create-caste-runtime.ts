import type { CasteRuntime } from "./caste-runtime.js";
import { PiCasteRuntime } from "./pi-caste-runtime.js";
import { createDefaultScriptedCasteRuntime } from "./scripted-caste-runtime.js";

export interface CreateCasteRuntimeOptions {
  createPiRuntime?: () => CasteRuntime;
  createScriptedRuntime?: () => CasteRuntime;
}

export interface CreateCasteRuntimeContext {
  root?: string;
  issueId?: string;
}

export function createCasteRuntime(
  runtime: string,
  options: CreateCasteRuntimeOptions = {},
  context: CreateCasteRuntimeContext = {},
): CasteRuntime {
  const createPiRuntime = options.createPiRuntime ?? (() => new PiCasteRuntime());
  const createScriptedRuntime = options.createScriptedRuntime
    ?? (() => createDefaultScriptedCasteRuntime(context.root, context.issueId));

  if (runtime === "pi") {
    return createPiRuntime();
  }

  return createScriptedRuntime();
}
