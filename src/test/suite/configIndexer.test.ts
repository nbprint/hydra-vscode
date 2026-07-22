import * as assert from "assert";
import * as path from "path";
import { HydraConfigIndexer } from "../../providers/configIndexer";

suite("HydraConfigIndexer", () => {
  test("excludes Python environment config directories", async () => {
    const indexer = new HydraConfigIndexer();

    await indexer.indexWorkspace();

    const indexedPaths = indexer.getAllEntries().map((entry) => entry.filePath);
    assert.ok(indexedPaths.some((filePath) => filePath.endsWith("conf/base.yaml")));
    assert.ok(
      indexedPaths.every(
        (filePath) =>
          !filePath.includes(`${path.sep}.venv${path.sep}`) &&
          !filePath.includes(`${path.sep}.nox${path.sep}`)
      )
    );
  });
});
