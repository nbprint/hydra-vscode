/**
 * Hydra Goto-Definition Provider.
 *
 * Supports:
 * - Jumping to config files referenced in `defaults:` lists.
 * - Jumping to the definition of `_target_` Python class/function (opens search).
 * - Jumping to config groups from override-style entries.
 */
import * as vscode from "vscode";
import { HydraConfigIndexer } from "./configIndexer";

export class HydraDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private indexer: HydraConfigIndexer) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Definition | undefined> {
    const line = document.lineAt(position.line).text;

    // --- 1. Defaults list entries ---
    const defaultsDef = this.resolveDefaultsEntry(document, position, line);
    if (defaultsDef) return defaultsDef;

    // --- 2. _target_ values: link to Python file ---
    const targetDef = await this.resolveTargetValue(document, position, line);
    if (targetDef) return targetDef;

    // --- 3. OmegaConf interpolation: ${path.to.key} -> goto key ---
    const interpDef = await this.resolveInterpolation(document, position, line);
    if (interpDef) return interpDef;

    return undefined;
  }

  private resolveDefaultsEntry(
    document: vscode.TextDocument,
    position: vscode.Position,
    line: string
  ): vscode.Location | undefined {
    // Match defaults entry pattern:  - [optional|override] group/path: option
    const defaultsMatch = line.match(
      /^\s*-\s+(?:optional\s+|override\s+)?(\/?\w[\w/]*)(?:@[\w_.]+)?(?:\s*:\s*(\S+))?\s*$/
    );
    if (!defaultsMatch) return undefined;

    // Make sure this line is inside a `defaults:` block
    if (!this.isInsideDefaultsBlock(document, position.line)) return undefined;

    const group = defaultsMatch[1];
    const option = defaultsMatch[2];

    // Determine which part of the line the cursor is on
    let configPath: string;
    if (option && option !== "???" && option !== "null") {
      // Look for group/option
      configPath = group + "/" + option;
    } else {
      configPath = group;
    }

    const entry = this.indexer.findConfigFile(configPath);
    if (entry) {
      return new vscode.Location(entry.uri, new vscode.Position(0, 0));
    }

    // Try matching just the group as a directory (show first file)
    const entries = this.indexer.findConfigs(group.replace(/^\//, ""), option);
    if (entries.length > 0) {
      return new vscode.Location(entries[0].uri, new vscode.Position(0, 0));
    }

    return undefined;
  }

  private async resolveTargetValue(
    document: vscode.TextDocument,
    position: vscode.Position,
    line: string
  ): Promise<vscode.Location[] | undefined> {
    // Match _target_: some.python.module.ClassName
    const targetMatch = line.match(/^\s*_target_\s*:\s*(\S+)/);
    if (!targetMatch) return undefined;

    const targetValue = targetMatch[1].replace(/["']/g, "");
    const parts = targetValue.split(".");
    if (parts.length < 2) return undefined;

    // Try to find the Python file in workspace
    const modulePath = parts.slice(0, -1).join("/") + ".py";
    const className = parts[parts.length - 1];

    const files = await vscode.workspace.findFiles(
      `**/${modulePath}`,
      "**/node_modules/**"
    );

    if (files.length > 0) {
      // Search for the class/function definition in the file
      const fileContent = await vscode.workspace.fs.readFile(files[0]);
      const text = Buffer.from(fileContent).toString("utf-8");
      const lines = text.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (
          lines[i].match(
            new RegExp(`^\\s*(class|def)\\s+${className}\\b`)
          )
        ) {
          return [new vscode.Location(files[0], new vscode.Position(i, 0))];
        }
      }

      // File found but class not found, still jump to file
      return [new vscode.Location(files[0], new vscode.Position(0, 0))];
    }

    return undefined;
  }

  private async resolveInterpolation(
    document: vscode.TextDocument,
    position: vscode.Position,
    line: string
  ): Promise<vscode.Location | undefined> {
    // Find ${...} at cursor position
    const interpolationRegex = /\$\{([^}]+)\}/g;
    let match: RegExpExecArray | null;

    while ((match = interpolationRegex.exec(line)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      if (position.character >= start && position.character <= end) {
        const innerText = match[1];

        // Skip resolver calls for definition lookup
        if (innerText.includes(":")) return undefined;

        // Resolve the path within the same document
        const dotPath = innerText.replace(/^\.*/, ""); // strip leading dots

        // Search in current document
        const text = document.getText();
        const lines = text.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const pathParts = dotPath.split(".");
          const firstKey = pathParts[0];
          if (lines[i].match(new RegExp(`^\\s*${escapeRegExp(firstKey)}\\s*:`))) {
            return new vscode.Location(
              document.uri,
              new vscode.Position(i, 0)
            );
          }
        }

        // Search across indexed configs
        const result = await this.indexer.resolveGlobalPath(dotPath);
        if (result.found) {
          const uri = vscode.Uri.file(result.filePath);
          return new vscode.Location(uri, new vscode.Position(0, 0));
        }

        return undefined;
      }
    }

    return undefined;
  }

  /**
   * Check whether the given line number is inside a `defaults:` block.
   */
  private isInsideDefaultsBlock(
    document: vscode.TextDocument,
    lineNumber: number
  ): boolean {
    // Walk backwards from current line to find `defaults:`
    for (let i = lineNumber; i >= 0; i--) {
      const line = document.lineAt(i).text;
      if (/^\s*defaults\s*:\s*$/.test(line)) {
        return true;
      }
      // If we hit a non-indented, non-empty line that's not a list item, stop
      if (/^\S/.test(line) && line.trim().length > 0 && i !== lineNumber) {
        return false;
      }
    }
    return false;
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
