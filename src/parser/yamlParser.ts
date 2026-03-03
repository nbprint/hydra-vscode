/**
 * Simple YAML parser utilities.
 *
 * Provides helpers for extracting keys, values, and positions from YAML documents
 * without pulling in a full YAML AST dependency at parse-time. For complex resolution
 * we fall back to the `yaml` npm package.
 */
import * as YAML from "yaml";

export interface YamlKeyValue {
  key: string;
  value: unknown;
  /** Line number in the document (0-based) */
  line: number;
}

export interface YamlFlatMap {
  /** Dot-separated path -> value */
  [dotPath: string]: unknown;
}

/**
 * Parse a YAML document and return a flat map of dot-separated paths to values.
 */
export function flattenYaml(text: string): YamlFlatMap {
  try {
    const doc = YAML.parseDocument(text);
    const result: YamlFlatMap = {};
    if (doc.contents && YAML.isMap(doc.contents)) {
      flattenNode(doc.contents, "", result);
    }
    return result;
  } catch {
    return {};
  }
}

function flattenNode(node: unknown, prefix: string, result: YamlFlatMap): void {
  if (YAML.isMap(node)) {
    for (const item of node.items) {
      const key = YAML.isScalar(item.key) ? String(item.key.value) : String(item.key);
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (YAML.isMap(item.value) || YAML.isSeq(item.value)) {
        flattenNode(item.value, fullKey, result);
      } else if (YAML.isScalar(item.value)) {
        result[fullKey] = item.value.value;
      } else {
        result[fullKey] = item.value;
      }
    }
  } else if (YAML.isSeq(node)) {
    for (let i = 0; i < node.items.length; i++) {
      const fullKey = `${prefix}[${i}]`;
      const item = node.items[i];
      if (YAML.isMap(item) || YAML.isSeq(item)) {
        flattenNode(item, fullKey, result);
      } else if (YAML.isScalar(item)) {
        result[fullKey] = item.value;
      } else {
        result[fullKey] = item;
      }
    }
  }
}

/**
 * Parse the line to extract a key: value pair (simple heuristic).
 */
export function parseLineKeyValue(line: string): { key: string; value: string } | null {
  const match = line.match(/^\s*([^#:]+?)\s*:\s*(.*)$/);
  if (!match) return null;
  return { key: match[1].trim(), value: match[2].trim() };
}

/**
 * Get the dot-path of the key at the given line in a YAML document text,
 * accounting for indentation hierarchy.
 */
export function getKeyPathAtLine(text: string, lineNumber: number): string[] {
  const lines = text.split("\n");
  const path: Array<{ indent: number; key: string }> = [];

  for (let i = 0; i <= lineNumber && i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.replace(/#.*$/, ""); // strip comments
    const match = stripped.match(/^(\s*)([\w][\w.-]*)\s*:/);
    if (!match) continue;

    const indent = match[1].length;
    const key = match[2];

    // Pop stack entries with >= indent
    while (path.length > 0 && path[path.length - 1].indent >= indent) {
      path.pop();
    }
    path.push({ indent, key });
  }

  return path.map((p) => p.key);
}

/**
 * Parse defaults list entries from a YAML document text.
 * Returns objects with group, option, and line info.
 */
export interface DefaultsEntry {
  group: string;
  option: string;
  packageTarget?: string;
  isOptional: boolean;
  isOverride: boolean;
  line: number;
}

export function parseDefaultsList(text: string): DefaultsEntry[] {
  const lines = text.split("\n");
  const entries: DefaultsEntry[] = [];
  let inDefaults = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*defaults\s*:\s*$/.test(line)) {
      inDefaults = true;
      continue;
    }

    if (inDefaults) {
      // End of defaults block: non-indented non-empty line that's not a list item
      if (/^\S/.test(line) && line.trim().length > 0) {
        inDefaults = false;
        continue;
      }

      // Match defaults entry patterns
      const entryMatch = line.match(
        /^\s*-\s+(optional\s+|override\s+)?(\/?\w[\w/]*)(?:@([\w_.]+))?(?:\s*:\s*(.+?))?\s*$/
      );
      if (entryMatch) {
        const modifier = entryMatch[1]?.trim();
        const group = entryMatch[2];
        const packageTarget = entryMatch[3];
        const option = entryMatch[4] || "";

        if (group === "_self_") continue;

        entries.push({
          group,
          option: option.trim(),
          packageTarget,
          isOptional: modifier === "optional",
          isOverride: modifier === "override",
          line: i,
        });
      }
    }
  }

  return entries;
}

/**
 * Resolve a dot-path within a flat YAML map.
 */
export function resolvePathInFlatMap(
  flatMap: YamlFlatMap,
  path: string[]
): { value: unknown; found: boolean } {
  const dotPath = path.join(".");
  if (dotPath in flatMap) {
    return { value: flatMap[dotPath], found: true };
  }
  return { value: undefined, found: false };
}
