/**
 * OmegaConf Hover Provider.
 *
 * Shows hover information for:
 * - `${...}` interpolation expressions (resolved value or resolver docs).
 * - Hydra special keys (_target_, _recursive_, etc.).
 * - `???` missing value markers.
 * - `# @package` directive explanation.
 */
import * as vscode from "vscode";
import { HydraConfigIndexer } from "./configIndexer";
import {
  parseInterpolations,
  findInterpolationAt,
  BUILTIN_RESOLVERS,
  HYDRA_RESOLVERS,
  HYDRA_SPECIAL_KEYS,
} from "../parser/interpolationParser";
import { flattenYaml } from "../parser/yamlParser";

export class OmegaConfHoverProvider implements vscode.HoverProvider {
  constructor(private indexer: HydraConfigIndexer) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    const line = document.lineAt(position.line).text;

    // --- 1. @package directive ---
    const packageHover = this.hoverPackageDirective(line, position);
    if (packageHover) return packageHover;

    // --- 2. Hydra special keys ---
    const specialKeyHover = this.hoverSpecialKey(line, position);
    if (specialKeyHover) return specialKeyHover;

    // --- 3. ??? missing value ---
    const missingHover = this.hoverMissingValue(line, position);
    if (missingHover) return missingHover;

    // --- 4. OmegaConf interpolation ---
    const interpHover = await this.hoverInterpolation(document, line, position);
    if (interpHover) return interpHover;

    return undefined;
  }

  private hoverPackageDirective(
    line: string,
    _position: vscode.Position
  ): vscode.Hover | undefined {
    const match = line.match(/^#\s*@package\s+(.*?)\s*$/);
    if (!match) return undefined;

    const pkgValue = match[1];
    const md = new vscode.MarkdownString();
    md.appendMarkdown("**Hydra @package Directive**\n\n");
    md.appendMarkdown(
      "Controls where this config is placed in the merged config tree.\n\n"
    );

    if (pkgValue === "_global_") {
      md.appendMarkdown("`_global_` — Merge at the root of the config tree.");
    } else if (pkgValue === "_group_") {
      md.appendMarkdown(
        "`_group_` — *(deprecated)* Merge at the config group path."
      );
    } else {
      md.appendMarkdown(`Package: \`${pkgValue}\``);
    }

    return new vscode.Hover(md);
  }

  private hoverSpecialKey(
    line: string,
    position: vscode.Position
  ): vscode.Hover | undefined {
    for (const [key, description] of Object.entries(HYDRA_SPECIAL_KEYS)) {
      const idx = line.indexOf(key);
      if (idx >= 0 && position.character >= idx && position.character <= idx + key.length) {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**Hydra: \`${key}\`**\n\n`);
        md.appendMarkdown(description);
        return new vscode.Hover(
          md,
          new vscode.Range(
            position.line,
            idx,
            position.line,
            idx + key.length
          )
        );
      }
    }
    return undefined;
  }

  private hoverMissingValue(
    line: string,
    position: vscode.Position
  ): vscode.Hover | undefined {
    const idx = line.indexOf("???");
    if (
      idx >= 0 &&
      position.character >= idx &&
      position.character <= idx + 3
    ) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown("**OmegaConf: MISSING value**\n\n");
      md.appendMarkdown(
        "This value is **mandatory** and must be provided before accessing.\n\n" +
          "Set it via Hydra CLI override, e.g. `key=value`, or in a composing config."
      );
      return new vscode.Hover(
        md,
        new vscode.Range(position.line, idx, position.line, idx + 3)
      );
    }
    return undefined;
  }

  private async hoverInterpolation(
    document: vscode.TextDocument,
    line: string,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    const nodes = parseInterpolations(line);
    const node = findInterpolationAt(nodes, position.character);
    if (!node) return undefined;

    const md = new vscode.MarkdownString();

    if (node.kind === "resolver") {
      const resolverName = node.resolverName!;
      const docs =
        BUILTIN_RESOLVERS[resolverName] || HYDRA_RESOLVERS[resolverName];

      md.appendMarkdown(`**OmegaConf Resolver: \`${resolverName}\`**\n\n`);
      if (docs) {
        md.appendMarkdown(docs + "\n\n");
      } else {
        md.appendMarkdown("Custom resolver (user-registered).\n\n");
      }

      if (node.resolverArgs) {
        md.appendCodeblock(
          `\${${resolverName}:${node.resolverArgs}}`,
          "yaml"
        );
      }
    } else {
      // Variable interpolation — try to resolve
      const dotPath = node.path.join(".");
      md.appendMarkdown(
        `**OmegaConf Interpolation: \`${node.text.trim()}\`**\n\n`
      );

      // Try to resolve in current document
      const docText = document.getText();
      const flatMap = flattenYaml(docText);

      if (dotPath in flatMap) {
        const value = flatMap[dotPath];
        md.appendMarkdown(`**Resolved value:** \`${formatValue(value)}\`\n\n`);
        md.appendMarkdown(`*Source: current file*`);
      } else {
        // Try global resolution
        const result = await this.indexer.resolveGlobalPath(dotPath);
        if (result.found) {
          md.appendMarkdown(
            `**Resolved value:** \`${formatValue(result.value)}\`\n\n`
          );
          md.appendMarkdown(`*Source: ${result.filePath}*`);
        } else {
          md.appendMarkdown(
            `⚠ Could not resolve \`${dotPath}\` in any indexed config.`
          );
        }
      }
    }

    return new vscode.Hover(
      md,
      new vscode.Range(
        position.line,
        node.start,
        position.line,
        node.end
      )
    );
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return `"${value}"`;
  return String(value);
}
