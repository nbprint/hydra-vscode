/**
 * OmegaConf Diagnostics Provider.
 *
 * Reports diagnostics (errors / warnings) for:
 * - Unclosed `${...}` interpolation expressions.
 * - Unresolvable interpolation references.
 * - Unknown resolver names (informational).
 * - Missing mandatory values (`???`) usage warnings.
 */
import * as vscode from "vscode";
import { HydraConfigIndexer } from "./configIndexer";
import {
  parseInterpolations,
  BUILTIN_RESOLVERS,
  HYDRA_RESOLVERS,
} from "../parser/interpolationParser";
import { flattenYaml } from "../parser/yamlParser";

export class OmegaConfDiagnosticsProvider implements vscode.Disposable {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private disposables: vscode.Disposable[] = [];

  constructor(private indexer: HydraConfigIndexer) {
    this.diagnosticCollection =
      vscode.languages.createDiagnosticCollection("hydra-omegaconf");
  }

  dispose(): void {
    this.diagnosticCollection.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  subscribeToDocumentChanges(_context: vscode.ExtensionContext): void {
    // Analyze open documents
    if (vscode.window.activeTextEditor) {
      this.analyzeDocument(vscode.window.activeTextEditor.document);
    }

    // Analyze on editor change
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.analyzeDocument(editor.document);
        }
      })
    );

    // Analyze on document change
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        this.analyzeDocument(e.document);
      })
    );

    // Clear diagnostics when document is closed
    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.diagnosticCollection.delete(doc.uri);
      })
    );
  }

  async analyzeDocument(document: vscode.TextDocument): Promise<void> {
    if (!this.isYamlDocument(document)) {
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();
    const lines = text.split("\n");
    const flatMap = flattenYaml(text);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for unclosed interpolations
      this.checkUnclosedInterpolations(line, i, diagnostics);

      // Check for ??? usage
      this.checkMissingValues(line, i, diagnostics);

      // Parse and validate interpolation references
      await this.checkInterpolationReferences(
        line,
        i,
        flatMap,
        document,
        diagnostics
      );
    }

    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  private isYamlDocument(document: vscode.TextDocument): boolean {
    return (
      document.languageId === "yaml" ||
      document.languageId === "hydra-yaml" ||
      document.fileName.endsWith(".yaml") ||
      document.fileName.endsWith(".yml")
    );
  }

  private checkUnclosedInterpolations(
    line: string,
    lineNumber: number,
    diagnostics: vscode.Diagnostic[]
  ): void {
    let depth = 0;
    let lastOpen = -1;

    for (let i = 0; i < line.length; i++) {
      if (line[i] === "\\" && i + 1 < line.length) {
        i++; // skip escape
        continue;
      }
      if (line[i] === "$" && i + 1 < line.length && line[i + 1] === "{") {
        if (depth === 0) lastOpen = i;
        depth++;
        i++;
        continue;
      }
      if (line[i] === "}") {
        depth--;
      }
    }

    if (depth > 0 && lastOpen >= 0) {
      const range = new vscode.Range(
        lineNumber,
        lastOpen,
        lineNumber,
        line.length
      );
      diagnostics.push(
        new vscode.Diagnostic(
          range,
          "Unclosed OmegaConf interpolation: missing closing '}'",
          vscode.DiagnosticSeverity.Error
        )
      );
    }
  }

  private checkMissingValues(
    line: string,
    lineNumber: number,
    diagnostics: vscode.Diagnostic[]
  ): void {
    // Match ??? as a value (after colon)
    const match = line.match(/:\s*(\?\?\?)\s*(?:#.*)?$/);
    if (match) {
      const idx = line.indexOf("???", line.indexOf(":"));
      if (idx >= 0) {
        const range = new vscode.Range(lineNumber, idx, lineNumber, idx + 3);
        diagnostics.push(
          new vscode.Diagnostic(
            range,
            "OmegaConf MISSING value: must be set before access.",
            vscode.DiagnosticSeverity.Warning
          )
        );
      }
    }
  }

  private async checkInterpolationReferences(
    line: string,
    lineNumber: number,
    flatMap: Record<string, unknown>,
    document: vscode.TextDocument,
    diagnostics: vscode.Diagnostic[]
  ): Promise<void> {
    const nodes = parseInterpolations(line);

    for (const node of nodes) {
      if (node.kind === "variable") {
        const dotPath = node.path.join(".");

        // Skip relative references (leading dots) — hard to resolve statically
        if (node.text.trim().startsWith(".")) continue;

        // Skip empty paths
        if (!dotPath) continue;

        // Check if it resolves in the current document
        if (dotPath in flatMap) continue;

        // Check if it resolves in hydra namespace (runtime)
        if (dotPath.startsWith("hydra.") || dotPath === "hydra") continue;

        // Try global resolution
        const result = await this.indexer.resolveGlobalPath(dotPath);
        if (result.found) continue;

        // Report as info diagnostic (might be resolved at runtime)
        const range = new vscode.Range(
          lineNumber,
          node.start,
          lineNumber,
          node.end
        );
        diagnostics.push(
          new vscode.Diagnostic(
            range,
            `Cannot resolve interpolation '\${${dotPath}}' in indexed configs. It may be provided at runtime.`,
            vscode.DiagnosticSeverity.Information
          )
        );
      }

      if (node.kind === "resolver") {
        const resolverName = node.resolverName!;

        // Known resolvers are fine
        if (resolverName in BUILTIN_RESOLVERS) continue;
        if (resolverName in HYDRA_RESOLVERS) continue;

        // Custom resolver — just informational hint
        const range = new vscode.Range(
          lineNumber,
          node.start,
          lineNumber,
          node.end
        );
        diagnostics.push(
          new vscode.Diagnostic(
            range,
            `'${resolverName}' is not a built-in OmegaConf/Hydra resolver. Ensure it is registered at runtime.`,
            vscode.DiagnosticSeverity.Hint
          )
        );
      }
    }
  }
}
