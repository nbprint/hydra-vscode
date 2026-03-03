/**
 * Hydra Config Indexer.
 *
 * Scans workspace directories for YAML config files and builds an index
 * mapping config group paths to file locations. Used by DefinitionProvider
 * and HoverProvider to resolve Hydra references.
 */
import * as vscode from "vscode";
import * as path from "path";
import { flattenYaml, YamlFlatMap } from "../parser/yamlParser";

export interface ConfigEntry {
  /** Config group path, e.g. "db" or "server/apache" */
  group: string;
  /** Config option name (filename without extension), e.g. "mysql" */
  option: string;
  /** Absolute file path */
  filePath: string;
  /** URI for the file */
  uri: vscode.Uri;
}

export class HydraConfigIndexer {
  private entries: ConfigEntry[] = [];
  private flatMaps: Map<string, YamlFlatMap> = new Map();
  private configRoots: string[] = [];

  /**
   * Scan the workspace for Hydra config directories and index all YAML files.
   */
  async indexWorkspace(): Promise<void> {
    this.entries = [];
    this.flatMaps.clear();

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const config = vscode.workspace.getConfiguration("hydra");
    const searchPaths = config.get<string[]>("configSearchPaths", [
      "conf",
      "config",
      "configs",
    ]);

    this.configRoots = [];

    // 1. Look for configured search paths at workspace root
    for (const folder of workspaceFolders) {
      for (const sp of searchPaths) {
        const configDir = path.join(folder.uri.fsPath, sp);
        try {
          const stat = await vscode.workspace.fs.stat(vscode.Uri.file(configDir));
          if (stat.type === vscode.FileType.Directory) {
            this.configRoots.push(configDir);
          }
        } catch {
          // Directory doesn't exist, skip
        }
      }
    }

    // 2. Auto-discover config roots: find directories named conf/config/configs
    //    anywhere in the workspace (handles nested project structures)
    const configDirNames = new Set(searchPaths);
    const yamlFiles = await vscode.workspace.findFiles(
      "**/*.{yaml,yml}",
      "{**/node_modules/**,**/out/**,**/.vscode-test/**}"
    );

    const discoveredRoots = new Set<string>();
    for (const fileUri of yamlFiles) {
      // Walk up from each YAML file to find a parent dir matching search paths
      let dir = path.dirname(fileUri.fsPath);
      const visited = new Set<string>();
      while (dir && !visited.has(dir)) {
        visited.add(dir);
        const dirName = path.basename(dir);
        if (configDirNames.has(dirName)) {
          discoveredRoots.add(dir);
          break;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }

    for (const root of discoveredRoots) {
      if (!this.configRoots.includes(root)) {
        this.configRoots.push(root);
      }
    }

    // 3. Index all YAML files under each config root
    for (const root of this.configRoots) {
      const relativeFiles = yamlFiles.filter((f) =>
        f.fsPath.startsWith(root + path.sep)
      );

      for (const fileUri of relativeFiles) {
        const relativePath = path.relative(root, fileUri.fsPath);
        const parsed = path.parse(relativePath);
        const dirPart = parsed.dir; // e.g. "db" or "server"
        const namePart = parsed.name; // e.g. "mysql" or "apache"

        const group = dirPart || "";
        const option = namePart;

        this.entries.push({
          group: group.replace(/\\/g, "/"),
          option,
          filePath: fileUri.fsPath,
          uri: fileUri,
        });
      }
    }
  }

  /**
   * Look up config entries matching a group and optional option.
   */
  findConfigs(group: string, option?: string): ConfigEntry[] {
    const normalizedGroup = group.replace(/^\//, ""); // strip leading slash
    return this.entries.filter((e) => {
      if (option) {
        return e.group === normalizedGroup && e.option === option;
      }
      // If no option, match the group as a path prefix
      return (
        e.group === normalizedGroup ||
        e.group.startsWith(normalizedGroup + "/") ||
        (normalizedGroup.includes("/") &&
          normalizedGroup === `${e.group}/${e.option}`)
      );
    });
  }

  /**
   * Find a specific config file by group/option path.
   * For example "db/mysql" -> look for group="db", option="mysql"
   */
  findConfigFile(configPath: string): ConfigEntry | undefined {
    const normalized = configPath.replace(/^\//, "");
    const parts = normalized.split("/");

    if (parts.length === 1) {
      // Could be a top-level config: group="" option="config"
      return (
        this.entries.find(
          (e) => e.group === "" && e.option === parts[0]
        ) ||
        this.entries.find(
          (e) => e.group === parts[0] && e.option === parts[0]
        )
      );
    }

    // group/option: group = all-but-last, option = last
    const option = parts[parts.length - 1];
    const group = parts.slice(0, -1).join("/");
    return this.entries.find(
      (e) => e.group === group && e.option === option
    );
  }

  /**
   * Parse and cache the flat map for a config file.
   */
  async getFlatMap(filePath: string): Promise<YamlFlatMap> {
    if (this.flatMaps.has(filePath)) {
      return this.flatMaps.get(filePath)!;
    }

    try {
      const content = await vscode.workspace.fs.readFile(
        vscode.Uri.file(filePath)
      );
      const text = Buffer.from(content).toString("utf-8");
      const flatMap = flattenYaml(text);
      this.flatMaps.set(filePath, flatMap);
      return flatMap;
    } catch {
      return {};
    }
  }

  /**
   * Resolve a dot-path across all indexed config files.
   * Returns the first matching value found.
   */
  async resolveGlobalPath(
    dotPath: string
  ): Promise<{ value: unknown; filePath: string; found: boolean }> {
    for (const entry of this.entries) {
      const flatMap = await this.getFlatMap(entry.filePath);
      if (dotPath in flatMap) {
        return { value: flatMap[dotPath], filePath: entry.filePath, found: true };
      }
    }
    return { value: undefined, filePath: "", found: false };
  }

  /**
   * Resolve a dot-path within a specific document's flat map (by URI).
   */
  async resolveInDocument(
    uri: vscode.Uri,
    dotPath: string
  ): Promise<{ value: unknown; found: boolean }> {
    const flatMap = await this.getFlatMap(uri.fsPath);
    if (dotPath in flatMap) {
      return { value: flatMap[dotPath], found: true };
    }
    return { value: undefined, found: false };
  }

  /**
   * Invalidate the cache for a specific file.
   */
  invalidateCache(filePath: string): void {
    this.flatMaps.delete(filePath);
  }

  /**
   * Get all indexed entries.
   */
  getAllEntries(): ConfigEntry[] {
    return [...this.entries];
  }

  /**
   * Get all config roots.
   */
  getConfigRoots(): string[] {
    return [...this.configRoots];
  }
}
