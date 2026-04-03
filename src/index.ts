import { resolveProjectPaths } from "./shared/paths.js";

export interface BootstrapManifest {
  appName: "aegis";
  paths: ReturnType<typeof resolveProjectPaths>;
}

export function buildBootstrapManifest(
  root = process.cwd(),
): BootstrapManifest {
  return {
    appName: "aegis",
    paths: resolveProjectPaths(root),
  };
}
