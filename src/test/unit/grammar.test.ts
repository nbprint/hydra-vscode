/**
 * TextMate grammar tests.
 * Validates that the Hydra YAML grammar tokenizes correctly.
 */
import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";

// We test the grammar structure directly since vscode-tmgrammar-test 
// requires a full VS Code runtime. Instead, we validate the JSON schema
// and pattern structure of the grammar file.

function getGrammarPath(): string {
  // Support both CJS (__dirname) and ESM (import.meta.url)
  try {
    // CJS path
    if (typeof __dirname !== "undefined") {
      return path.resolve(__dirname, "../../../syntaxes/hydra-yaml.tmLanguage.json");
    }
  } catch { /* ignore */ }
  // ESM fallback: resolve from project root
  const root = process.cwd();
  return path.resolve(root, "syntaxes/hydra-yaml.tmLanguage.json");
}

suite("TextMate Grammar", () => {
  let grammar: any;

  suiteSetup(() => {
    const grammarPath = getGrammarPath();
    const content = fs.readFileSync(grammarPath, "utf-8");
    grammar = JSON.parse(content);
  });

  test("should have correct scopeName", () => {
    assert.strictEqual(grammar.scopeName, "source.hydra-yaml");
  });

  test("should have correct name", () => {
    assert.strictEqual(grammar.name, "Hydra YAML");
  });

  test("should define fileTypes", () => {
    assert.ok(grammar.fileTypes.includes("yaml"));
    assert.ok(grammar.fileTypes.includes("yml"));
  });

  test("should have top-level patterns", () => {
    assert.ok(Array.isArray(grammar.patterns));
    assert.ok(grammar.patterns.length > 0);
  });

  test("should include comment pattern", () => {
    const commentRef = grammar.patterns.find(
      (p: any) => p.include === "#comment"
    );
    assert.ok(commentRef, "Should reference #comment pattern");
    assert.ok(grammar.repository.comment, "Should define comment in repository");
  });

  test("should include hydra-package-directive", () => {
    const ref = grammar.patterns.find(
      (p: any) => p.include === "#hydra-package-directive"
    );
    assert.ok(ref);
    const rule = grammar.repository["hydra-package-directive"];
    assert.ok(rule);
    assert.ok(rule.match.includes("@package"));
  });

  test("should define omegaconf-interpolation pattern", () => {
    const rule = grammar.repository["omegaconf-interpolation"];
    assert.ok(rule, "Should define omegaconf-interpolation");
    assert.ok(Array.isArray(rule.patterns));

    // Should have escaped and normal patterns
    assert.ok(rule.patterns.length >= 2);

    // Normal pattern should have begin/end for ${...}
    const normalPattern = rule.patterns.find((p: any) => p.begin);
    assert.ok(normalPattern, "Should have a begin/end pattern for ${...}");
    assert.ok(normalPattern.begin.includes("\\$\\{"));
  });

  test("should define interpolation-content with resolver patterns", () => {
    const rule = grammar.repository["interpolation-content"];
    assert.ok(rule);

    // Should recognize OmegaConf resolvers
    const ocResolverPattern = rule.patterns.find((p: any) =>
      p.name?.includes("resolver.omegaconf")
    );
    assert.ok(ocResolverPattern, "Should have OmegaConf resolver pattern");
    // The grammar uses escaped dots \\. in the regex
    assert.ok(ocResolverPattern.match.includes("oc"));
    assert.ok(ocResolverPattern.match.includes("env"));
    assert.ok(ocResolverPattern.match.includes("decode"));
    assert.ok(ocResolverPattern.match.includes("select"));
    assert.ok(ocResolverPattern.match.includes("dict"));

    // Should recognize Hydra resolvers
    const hydraResolverPattern = rule.patterns.find((p: any) =>
      p.name?.includes("resolver.hydra")
    );
    assert.ok(hydraResolverPattern, "Should have Hydra resolver pattern");
    assert.ok(hydraResolverPattern.match.includes("now"));
    assert.ok(hydraResolverPattern.match.includes("hydra"));
    assert.ok(hydraResolverPattern.match.includes("python_version"));
  });

  test("should define defaults-block pattern", () => {
    const rule = grammar.repository["defaults-block"];
    assert.ok(rule);
    assert.ok(rule.begin.includes("defaults"));
  });

  test("should define defaults-entry with modifiers", () => {
    const rule = grammar.repository["defaults-entry"];
    assert.ok(rule);

    // Should have _self_ pattern
    const selfPattern = rule.patterns.find((p: any) =>
      p.name?.includes("self")
    );
    assert.ok(selfPattern, "Should have _self_ pattern");

    // Should have general defaults entry pattern with modifiers
    const entryPattern = rule.patterns.find((p: any) =>
      p.name?.includes("defaults-entry.hydra-yaml") && 
      !p.name.includes("self")
    );
    assert.ok(entryPattern, "Should have general defaults entry pattern");

    // Check captures for optional/override keywords
    const modifierCapture = entryPattern.captures["2"];
    assert.ok(modifierCapture);
    assert.ok(
      modifierCapture.name.includes("keyword.control.modifier"),
      "Should highlight optional/override as keyword"
    );
  });

  test("should define hydra-special-key for instantiate keys", () => {
    const rule = grammar.repository["hydra-special-key"];
    assert.ok(rule);

    // Should match _target_, etc.
    const pattern = rule.patterns[0];
    assert.ok(pattern.match.includes("_target_"));
    assert.ok(pattern.match.includes("_recursive_"));
    assert.ok(pattern.match.includes("_convert_"));
    assert.ok(pattern.match.includes("_partial_"));
    assert.ok(pattern.match.includes("_args_"));
  });

  test("should define hydra-missing-value for ???", () => {
    const rule = grammar.repository["hydra-missing-value"];
    assert.ok(rule);
    assert.ok(rule.match.includes("\\?\\?\\?"));
    assert.ok(rule.name.includes("missing"));
  });

  test("should define constant patterns for bool/null", () => {
    const rule = grammar.repository["constant"];
    assert.ok(rule);

    const boolPattern = rule.patterns.find((p: any) =>
      p.name?.includes("boolean")
    );
    assert.ok(boolPattern);
    assert.ok(boolPattern.match.includes("true"));
    assert.ok(boolPattern.match.includes("false"));

    const nullPattern = rule.patterns.find((p: any) =>
      p.name?.includes("null")
    );
    assert.ok(nullPattern);
    assert.ok(nullPattern.match.includes("null"));
  });

  test("should define quoted string patterns with interpolation support", () => {
    const doubleQuoted = grammar.repository["quoted-string-double"];
    assert.ok(doubleQuoted);
    assert.strictEqual(doubleQuoted.begin, '"');
    assert.strictEqual(doubleQuoted.end, '"');

    // Double-quoted strings should support interpolation
    const interpRef = doubleQuoted.patterns.find((p: any) =>
      p.include === "#omegaconf-interpolation"
    );
    assert.ok(interpRef, "Double-quoted strings should include interpolation");

    const singleQuoted = grammar.repository["quoted-string-single"];
    assert.ok(singleQuoted);
    assert.strictEqual(singleQuoted.begin, "'");
    assert.strictEqual(singleQuoted.end, "'");
  });

  test("should define flow collection patterns", () => {
    const rule = grammar.repository["flow-collection"];
    assert.ok(rule);
    assert.ok(Array.isArray(rule.patterns));

    // Should have both mapping and sequence
    const mappingPattern = rule.patterns.find((p: any) =>
      p.name?.includes("flow-mapping")
    );
    assert.ok(mappingPattern);

    const seqPattern = rule.patterns.find((p: any) =>
      p.name?.includes("flow-sequence")
    );
    assert.ok(seqPattern);
  });

  test("should define numeric patterns", () => {
    const rule = grammar.repository["numeric"];
    assert.ok(rule);

    const intPattern = rule.patterns.find((p: any) =>
      p.name?.includes("integer")
    );
    assert.ok(intPattern);

    const floatPattern = rule.patterns.find((p: any) =>
      p.name?.includes("float")
    );
    assert.ok(floatPattern);

    const infPattern = rule.patterns.find((p: any) =>
      p.name?.includes("inf")
    );
    assert.ok(infPattern);

    const nanPattern = rule.patterns.find((p: any) =>
      p.name?.includes("nan")
    );
    assert.ok(nanPattern);
  });

  test("should define package keywords in directive", () => {
    const rule = grammar.repository["hydra-package-directive"];
    assert.ok(rule);

    // The package value capture should recognize _global_, _group_, etc.
    const pkgCapture = rule.captures["3"];
    assert.ok(pkgCapture);
    assert.ok(pkgCapture.patterns);

    const keywordPattern = pkgCapture.patterns[0];
    assert.ok(keywordPattern.match.includes("_global_"));
    assert.ok(keywordPattern.match.includes("_group_"));
    assert.ok(keywordPattern.match.includes("_name_"));
    assert.ok(keywordPattern.match.includes("_here_"));
  });

  test("grammar JSON should be valid (no circular references)", () => {
    // Verify it can be stringified (no circular refs)
    const json = JSON.stringify(grammar);
    assert.ok(json.length > 0);

    // Verify all repository references exist
    const allIncludes: string[] = [];
    function findIncludes(obj: any): void {
      if (typeof obj === "string" && obj.startsWith("#")) {
        allIncludes.push(obj.substring(1));
      }
      if (Array.isArray(obj)) {
        obj.forEach(findIncludes);
      } else if (obj && typeof obj === "object") {
        Object.values(obj).forEach(findIncludes);
      }
    }
    findIncludes(grammar.patterns);
    findIncludes(grammar.repository);

    for (const ref of allIncludes) {
      assert.ok(
        grammar.repository[ref],
        `Referenced pattern #${ref} not found in repository`
      );
    }
  });
});
