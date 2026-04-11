export const AEGIS_PACKAGE_JSON_ALIASES = {
  "aegis:init": "aegis init",
  "aegis:start": "aegis start",
  "aegis:status": "aegis status",
  "aegis:stop": "aegis stop",
} as const;

export interface EnsurePackageJsonAliasesResult {
  changed: boolean;
  packageJsonText: string;
}

interface JsonPropertyRange {
  keyStart: number;
  valueStart: number;
  valueEnd: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function skipWhitespace(source: string, index: number): number {
  let cursor = index;

  while (cursor < source.length) {
    const char = source[cursor];
    if (char !== " " && char !== "\t" && char !== "\n" && char !== "\r") {
      break;
    }
    cursor += 1;
  }

  return cursor;
}

function findStringEnd(source: string, index: number): number {
  let cursor = index + 1;

  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === "\"") {
      return cursor + 1;
    }
    cursor += 1;
  }

  throw new Error("Unterminated JSON string.");
}

function findCompositeEnd(
  source: string,
  index: number,
  openChar: "{" | "[",
  closeChar: "}" | "]",
): number {
  let depth = 0;
  let cursor = index;

  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "\"") {
      cursor = findStringEnd(source, cursor);
      continue;
    }
    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return cursor + 1;
      }
    }
    cursor += 1;
  }

  throw new Error(`Unterminated JSON ${openChar}.`);
}

function findValueEnd(source: string, index: number): number {
  const char = source[index];
  if (char === "\"") {
    return findStringEnd(source, index);
  }
  if (char === "{") {
    return findCompositeEnd(source, index, "{", "}");
  }
  if (char === "[") {
    return findCompositeEnd(source, index, "[", "]");
  }

  let cursor = index;
  while (cursor < source.length) {
    const current = source[cursor];
    if (
      current === ","
      || current === "}"
      || current === "]"
      || current === " "
      || current === "\t"
      || current === "\n"
      || current === "\r"
    ) {
      break;
    }
    cursor += 1;
  }

  return cursor;
}

function findObjectProperty(
  source: string,
  objectStart: number,
  propertyName: string,
): JsonPropertyRange | null {
  let cursor = skipWhitespace(source, objectStart + 1);

  while (cursor < source.length) {
    if (source[cursor] === "}") {
      return null;
    }
    if (source[cursor] !== "\"") {
      return null;
    }

    const keyStart = cursor;
    const keyEnd = findStringEnd(source, cursor);
    const key = JSON.parse(source.slice(keyStart, keyEnd)) as string;
    cursor = skipWhitespace(source, keyEnd);

    if (source[cursor] !== ":") {
      return null;
    }

    const valueStart = skipWhitespace(source, cursor + 1);
    const valueEnd = findValueEnd(source, valueStart);
    const next = skipWhitespace(source, valueEnd);

    if (key === propertyName) {
      return {
        keyStart,
        valueStart,
        valueEnd,
      };
    }

    if (source[next] === ",") {
      cursor = skipWhitespace(source, next + 1);
      continue;
    }
    if (source[next] === "}") {
      return null;
    }
    return null;
  }

  return null;
}

function detectLineBreak(source: string): string {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function getLineIndentBefore(source: string, index: number): string {
  const lineStart = source.lastIndexOf("\n", index - 1);
  const start = lineStart === -1 ? 0 : lineStart + 1;
  const segment = source.slice(start, index);

  return /^[\t ]*$/.test(segment) ? segment : "";
}

function detectIndentUnit(
  source: string,
  objectStart: number,
  objectEnd: number,
  fallbackIndentUnit: string,
): string {
  const firstEntryStart = skipWhitespace(source, objectStart + 1);
  if (firstEntryStart < objectEnd && source[firstEntryStart] === "\"") {
    const entryIndent = getLineIndentBefore(source, firstEntryStart);
    const closingIndent = getLineIndentBefore(source, objectEnd);

    if (
      entryIndent.length > closingIndent.length
      && entryIndent.startsWith(closingIndent)
    ) {
      return entryIndent.slice(closingIndent.length);
    }
  }

  return fallbackIndentUnit;
}

function serializeEntries(
  entries: ReadonlyArray<readonly [string, string]>,
  indent: string,
  lineBreak: string,
): string {
  return entries
    .map(([name, command]) => `${indent}${JSON.stringify(name)}: ${JSON.stringify(command)}`)
    .join(`,${lineBreak}`);
}

function patchExistingScriptsObject(
  source: string,
  scriptsRange: JsonPropertyRange,
  entries: ReadonlyArray<readonly [string, string]>,
  lineBreak: string,
  parentIndentUnit: string,
): string {
  const objectStart = scriptsRange.valueStart;
  const objectEnd = scriptsRange.valueEnd - 1;
  const firstEntryStart = skipWhitespace(source, objectStart + 1);
  const isMultiline = source.slice(objectStart + 1, objectEnd).includes("\n")
    || source.slice(objectStart + 1, objectEnd).includes("\r");

  if (isMultiline) {
    const closingIndent = getLineIndentBefore(source, objectEnd);
    const indentUnit = detectIndentUnit(
      source,
      objectStart,
      objectEnd,
      parentIndentUnit,
    );

    if (firstEntryStart < objectEnd && source[firstEntryStart] === "\"") {
      const entryIndent = getLineIndentBefore(source, firstEntryStart);
      const addition = serializeEntries(entries, entryIndent, lineBreak);
      const closingLineStart = objectEnd - closingIndent.length;
      const insertionPoint = closingLineStart - lineBreak.length;

      return `${source.slice(0, insertionPoint)},${lineBreak}${addition}${lineBreak}${closingIndent}${source.slice(objectEnd)}`;
    }

    const entryIndent = closingIndent + indentUnit;
    const body = serializeEntries(entries, entryIndent, lineBreak);

    return `${source.slice(0, objectStart + 1)}${lineBreak}${body}${lineBreak}${closingIndent}${source.slice(objectEnd)}`;
  }

  const inlineEntries = entries
    .map(([name, command]) => `${JSON.stringify(name)}: ${JSON.stringify(command)}`)
    .join(", ");

  if (firstEntryStart < objectEnd) {
    return `${source.slice(0, objectEnd)}, ${inlineEntries}${source.slice(objectEnd)}`;
  }

  return `${source.slice(0, objectStart + 1)}${inlineEntries}${source.slice(objectEnd)}`;
}

function patchMissingScriptsProperty(
  source: string,
  rootStart: number,
  rootEnd: number,
  entries: ReadonlyArray<readonly [string, string]>,
  lineBreak: string,
): string {
  const firstPropertyStart = skipWhitespace(source, rootStart + 1);
  const closingIndent = getLineIndentBefore(source, rootEnd);
  const rootIndentUnit = detectIndentUnit(source, rootStart, rootEnd, "  ");
  const hasExistingProperties = firstPropertyStart < rootEnd && source[firstPropertyStart] !== "}";
  const isMultiline = source.slice(rootStart + 1, rootEnd).includes("\n")
    || source.slice(rootStart + 1, rootEnd).includes("\r");

  if (isMultiline) {
    const propertyIndent = hasExistingProperties
      ? getLineIndentBefore(source, firstPropertyStart)
      : closingIndent + rootIndentUnit;
    const childIndent = propertyIndent + rootIndentUnit;
    const scriptsProperty = `${propertyIndent}"scripts": {${lineBreak}${serializeEntries(entries, childIndent, lineBreak)}${lineBreak}${propertyIndent}}`;
    const prefix = hasExistingProperties ? `,${lineBreak}` : `${lineBreak}`;
    const suffix = hasExistingProperties ? "" : `${lineBreak}${closingIndent}`;

    return `${source.slice(0, rootEnd)}${prefix}${scriptsProperty}${suffix}${source.slice(rootEnd)}`;
  }

  const inlineEntries = entries
    .map(([name, command]) => `${JSON.stringify(name)}: ${JSON.stringify(command)}`)
    .join(", ");
  const scriptsProperty = `"scripts": {${inlineEntries}}`;
  const prefix = hasExistingProperties ? ", " : "";

  return `${source.slice(0, rootEnd)}${prefix}${scriptsProperty}${source.slice(rootEnd)}`;
}

export function ensureAegisPackageJsonAliases(
  packageJsonText: string,
): EnsurePackageJsonAliasesResult {
  let parsedPackageJson: unknown;

  try {
    parsedPackageJson = JSON.parse(packageJsonText) as unknown;
  } catch {
    return {
      changed: false,
      packageJsonText,
    };
  }

  if (!isRecord(parsedPackageJson)) {
    return {
      changed: false,
      packageJsonText,
    };
  }

  if (
    parsedPackageJson.scripts !== undefined
    && !isRecord(parsedPackageJson.scripts)
  ) {
    return {
      changed: false,
      packageJsonText,
    };
  }

  const scripts = parsedPackageJson.scripts;
  if (isRecord(scripts) && Object.values(scripts).some((value) => typeof value !== "string")) {
    return {
      changed: false,
      packageJsonText,
    };
  }

  const missingEntries = Object.entries(AEGIS_PACKAGE_JSON_ALIASES)
    .filter(([name]) => !isRecord(scripts) || !(name in scripts));

  if (missingEntries.length === 0) {
    return {
      changed: false,
      packageJsonText,
    };
  }

  const rootStart = skipWhitespace(packageJsonText, 0);
  if (packageJsonText[rootStart] !== "{") {
    return {
      changed: false,
      packageJsonText,
    };
  }

  const rootEndExclusive = findValueEnd(packageJsonText, rootStart);
  const rootEnd = rootEndExclusive - 1;
  const lineBreak = detectLineBreak(packageJsonText);
  const rootIndentUnit = detectIndentUnit(packageJsonText, rootStart, rootEnd, "  ");

  if (isRecord(scripts)) {
    const scriptsRange = findObjectProperty(packageJsonText, rootStart, "scripts");
    if (
      scriptsRange === null
      || packageJsonText[scriptsRange.valueStart] !== "{"
    ) {
      return {
        changed: false,
        packageJsonText,
      };
    }

    return {
      changed: true,
      packageJsonText: patchExistingScriptsObject(
        packageJsonText,
        scriptsRange,
        missingEntries,
        lineBreak,
        rootIndentUnit,
      ),
    };
  }

  return {
    changed: true,
    packageJsonText: patchMissingScriptsProperty(
      packageJsonText,
      rootStart,
      rootEnd,
      missingEntries,
      lineBreak,
    ),
  };
}
