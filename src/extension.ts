import * as vscode from "vscode";
import { HydraConfigIndexer } from "./providers/configIndexer";
import { HydraDefinitionProvider } from "./providers/definitionProvider";
import { OmegaConfHoverProvider } from "./providers/hoverProvider";
import { OmegaConfDiagnosticsProvider } from "./providers/diagnosticsProvider";

let diagnosticsProvider: OmegaConfDiagnosticsProvider | undefined;

const INDEX_DEBOUNCE_MS = 500;

export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = [
    { language: "hydra-yaml", scheme: "file" },
    { language: "yaml", scheme: "file" },
  ];

  const configIndexer = new HydraConfigIndexer();

  // Index workspace on activation
  void configIndexer.indexWorkspace();

  // Re-index on config file changes
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.{yaml,yml}");
  let indexTimeout: NodeJS.Timeout | undefined;
  const scheduleIndex = (): void => {
    if (indexTimeout) clearTimeout(indexTimeout);
    indexTimeout = setTimeout(() => {
      indexTimeout = undefined;
      void configIndexer.indexWorkspace();
    }, INDEX_DEBOUNCE_MS);
  };
  watcher.onDidChange(scheduleIndex);
  watcher.onDidCreate(scheduleIndex);
  watcher.onDidDelete(scheduleIndex);
  context.subscriptions.push(watcher, {
    dispose: () => {
      if (indexTimeout) clearTimeout(indexTimeout);
    },
  });

  // Register definition provider (goto-definition for Hydra compose)
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      selector,
      new HydraDefinitionProvider(configIndexer)
    )
  );

  // Register hover provider (OmegaConf interpolation hover)
  const config = vscode.workspace.getConfiguration("hydra");
  if (config.get<boolean>("enableHover", true)) {
    context.subscriptions.push(
      vscode.languages.registerHoverProvider(
        selector,
        new OmegaConfHoverProvider(configIndexer)
      )
    );
  }

  // Register diagnostics provider
  if (config.get<boolean>("enableDiagnostics", true)) {
    diagnosticsProvider = new OmegaConfDiagnosticsProvider(configIndexer);
    context.subscriptions.push(diagnosticsProvider);
    diagnosticsProvider.subscribeToDocumentChanges(context);
  }
}

export function deactivate(): void {
  if (diagnosticsProvider) {
    diagnosticsProvider.dispose();
  }
}
