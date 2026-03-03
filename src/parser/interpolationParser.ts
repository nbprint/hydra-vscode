/**
 * OmegaConf interpolation parser.
 *
 * Parses `${...}` interpolation expressions from YAML values,
 * supporting nested interpolations, resolver syntax, and relative paths.
 */

export interface InterpolationNode {
  /** "variable" for plain path refs, "resolver" for resolver calls */
  kind: "variable" | "resolver";
  /** Full text of the expression (without outer ${}) */
  text: string;
  /** Dot-separated path segments (for variable) or resolver name (for resolver) */
  path: string[];
  /** For resolvers: the resolver name */
  resolverName?: string;
  /** For resolvers: the raw arguments string */
  resolverArgs?: string;
  /** Offset within the source string where `${` starts */
  start: number;
  /** Offset within the source string where `}` ends (exclusive) */
  end: number;
  /** Nested interpolation nodes */
  children: InterpolationNode[];
}

/**
 * Find all `${...}` interpolation expressions in a string, supporting nesting.
 */
export function parseInterpolations(input: string): InterpolationNode[] {
  const nodes: InterpolationNode[] = [];
  let pos = 0;

  while (pos < input.length) {
    // Skip escaped interpolations
    if (input[pos] === "\\" && pos + 1 < input.length && input[pos + 1] === "$") {
      pos += 2;
      continue;
    }

    if (input[pos] === "$" && pos + 1 < input.length && input[pos + 1] === "{") {
      const node = parseOneInterpolation(input, pos);
      if (node) {
        nodes.push(node);
        pos = node.end;
      } else {
        pos++;
      }
    } else {
      pos++;
    }
  }

  return nodes;
}

function parseOneInterpolation(input: string, start: number): InterpolationNode | null {
  // start points to '$', start+1 points to '{'
  let depth = 1;
  let pos = start + 2; // after '${'

  while (pos < input.length && depth > 0) {
    if (input[pos] === "\\" && pos + 1 < input.length) {
      pos += 2; // skip escape
      continue;
    }
    if (input[pos] === "$" && pos + 1 < input.length && input[pos + 1] === "{") {
      depth++;
      pos += 2;
      continue;
    }
    if (input[pos] === "}") {
      depth--;
      if (depth === 0) {
        break;
      }
    }
    pos++;
  }

  if (depth !== 0) {
    // unclosed interpolation
    return null;
  }

  const end = pos + 1; // after closing '}'
  const innerText = input.substring(start + 2, pos);
  const children = parseInterpolations(innerText);

  // Determine if this is a resolver call or a variable reference
  const colonIdx = findUnnestedColon(innerText);
  if (colonIdx >= 0) {
    const resolverName = innerText.substring(0, colonIdx).trim();
    const resolverArgs = innerText.substring(colonIdx + 1);
    return {
      kind: "resolver",
      text: innerText,
      path: resolverName.split("."),
      resolverName,
      resolverArgs,
      start,
      end,
      children,
    };
  } else {
    const pathStr = innerText.trim();
    const path = splitPath(pathStr);
    return {
      kind: "variable",
      text: innerText,
      path,
      start,
      end,
      children,
    };
  }
}

/**
 * Find the first colon that is not inside a nested `${...}`.
 */
function findUnnestedColon(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      i++; // skip escape
      continue;
    }
    if (s[i] === "$" && i + 1 < s.length && s[i + 1] === "{") {
      depth++;
      i++;
      continue;
    }
    if (s[i] === "}") {
      depth--;
      continue;
    }
    if (s[i] === ":" && depth === 0) {
      return i;
    }
  }
  return -1;
}

/**
 * Split a dot-path like ".foo.bar" or "a.b.c" into segments.
 * Leading dots represent relative path traversals.
 */
export function splitPath(path: string): string[] {
  if (!path) return [];
  // Handle bracket notation: foo[bar] -> foo.bar
  const normalized = path.replace(/\[([^\]]+)\]/g, ".$1");
  return normalized.split(".").filter((s) => s.length > 0 || path.startsWith("."));
}

/**
 * Find the interpolation at a given offset in the string.
 */
export function findInterpolationAt(
  nodes: InterpolationNode[],
  offset: number
): InterpolationNode | null {
  for (const node of nodes) {
    if (offset >= node.start && offset < node.end) {
      // Check children first (innermost match)
      const childMatch = findInterpolationAt(node.children, offset - node.start - 2);
      if (childMatch) {
        // Adjust offsets to be relative to outer string
        return {
          ...childMatch,
          start: childMatch.start + node.start + 2,
          end: childMatch.end + node.start + 2,
        };
      }
      return node;
    }
  }
  return null;
}

/**
 * Well-known OmegaConf built-in resolvers.
 */
export const BUILTIN_RESOLVERS: Record<string, string> = {
  "oc.env": "Read an environment variable. Usage: ${oc.env:VAR_NAME[,default]}",
  "oc.decode": "Decode a string as an OmegaConf value. Usage: ${oc.decode:value}",
  "oc.create": "Create a sub-config from a literal. Usage: ${oc.create:{a: 1}}",
  "oc.deprecated": "Redirect to a new key with deprecation warning. Usage: ${oc.deprecated:new.key}",
  "oc.select": "Select a value with optional default. Usage: ${oc.select:key[,default]}",
  "oc.dict.keys": "Get dictionary keys as list. Usage: ${oc.dict.keys:dict_key}",
  "oc.dict.values": "Get dictionary values as list. Usage: ${oc.dict.values:dict_key}",
};

/**
 * Hydra-specific resolvers.
 */
export const HYDRA_RESOLVERS: Record<string, string> = {
  now: "Current datetime. Usage: ${now:%Y-%m-%d_%H-%M-%S}",
  hydra: "Access Hydra runtime config. Usage: ${hydra.job.name}",
  python_version:
    "Python version string. Usage: ${python_version:major|minor|micro}",
};

/**
 * Known Hydra instantiate special keys.
 */
export const HYDRA_SPECIAL_KEYS: Record<string, string> = {
  _target_: "Fully-qualified class or function name to instantiate.",
  _recursive_: "Whether to recursively instantiate nested configs (default: true).",
  _convert_: 'Conversion strategy: "none", "partial", "object", "all".',
  _partial_: "If true, returns functools.partial instead of calling target.",
  _args_: "Positional arguments to pass to the target.",
};
