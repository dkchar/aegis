export const AEGIS_PACKAGE_JSON_ALIASES = {
  "aegis:init": "aegis init",
  "aegis:start": "aegis start",
  "aegis:status": "aegis status",
  "aegis:stop": "aegis stop",
} as const;

export interface EnsurePackageJsonAliasesResult {
  changed: boolean;
  packageJson: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ensureAegisPackageJsonAliases(
  packageJson: Record<string, unknown>,
): EnsurePackageJsonAliasesResult {
  if (
    packageJson.scripts !== undefined
    && !isRecord(packageJson.scripts)
  ) {
    return {
      changed: false,
      packageJson,
    };
  }

  const scripts = isRecord(packageJson.scripts) ? { ...packageJson.scripts } : {};
  let changed = false;

  for (const [name, command] of Object.entries(AEGIS_PACKAGE_JSON_ALIASES)) {
    if (!(name in scripts)) {
      scripts[name] = command;
      changed = true;
    }
  }

  if (!changed) {
    return {
      changed: false,
      packageJson,
    };
  }

  return {
    changed: true,
    packageJson: {
      ...packageJson,
      scripts,
    },
  };
}
