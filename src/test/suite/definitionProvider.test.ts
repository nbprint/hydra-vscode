import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

suite("HydraDefinitionProvider", () => {
  test("provides defaults targets to VS Code definition features", async () => {
    const extension = vscode.extensions.getExtension("timkpaine.hydra-vscode");
    assert.ok(extension);
    await extension.activate();

    const configUri = vscode.Uri.file(
      path.resolve(__dirname, "../../../src/test/fixtures/workspace/conf/config.yaml")
    );
    const document = await vscode.workspace.openTextDocument(configUri);
    const defaultsLine = document.getText().split("\n").findIndex((line) =>
      line.includes("db: mysql")
    );
    assert.notStrictEqual(defaultsLine, -1);

    const definitions = await vscode.commands.executeCommand<
      (vscode.Location | vscode.LocationLink)[]
    >(
      "vscode.executeDefinitionProvider",
      document.uri,
      new vscode.Position(defaultsLine, 10)
    );

    assert.ok(definitions);
    assert.strictEqual(definitions.length, 1);
    const targetUri =
      definitions[0] instanceof vscode.Location
        ? definitions[0].uri
        : definitions[0].targetUri;
    assert.strictEqual(
      targetUri.fsPath,
      path.resolve(
        __dirname,
        "../../../src/test/fixtures/workspace/conf/db/mysql.yaml"
      )
    );
  });
});
