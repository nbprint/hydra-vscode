# Hydra + OmegaConf for VS Code

[![CI](https://github.com/hydra-community/hydra-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/hydra-community/hydra-vscode/actions/workflows/ci.yml)

A VS Code extension providing rich language support for [Hydra](https://hydra.cc/) config files and [OmegaConf](https://omegaconf.readthedocs.io/) interpolation syntax.

## Features

### YAML Syntax Highlighting

Enhanced YAML highlighting for Hydra-specific constructs:

- **OmegaConf interpolations**: `${foo.bar}`, `${oc.env:HOME}`, nested `${${dynamic}}`
- **Hydra special keys**: `_target_`, `_recursive_`, `_convert_`, `_partial_`, `_args_`
- **Package directives**: `# @package _global_`
- **Defaults list**: `defaults:` block with `optional`, `override`, `_self_`, package `@` targets
- **Missing values**: `???` highlighted as mandatory markers
- **Built-in resolvers**: `oc.env`, `oc.decode`, `oc.select`, `now`, `hydra`, `python_version`, etc.
- **Escaped interpolations**: `\${not.interpolated}`

### Goto Definition

Jump to config file definitions from:

- **Defaults list entries**: `- db: mysql` → opens `conf/db/mysql.yaml`
- **`_target_` values**: `_target_: my_app.Trainer` → opens the Python source file
- **Interpolation paths**: `${db.host}` → jumps to where `host` is defined

### Hover Information

Hover over elements to see:

- **Interpolation values**: Shows the resolved value of `${...}` references
- **Resolver documentation**: Built-in docs for `oc.env`, `oc.select`, `now`, etc.
- **Special key docs**: Explains `_target_`, `_recursive_`, etc.
- **`???` markers**: Explains the OmegaConf MISSING value concept
- **`@package` directives**: Documentation for package placement

### Diagnostics

Real-time error and warning highlighting:

- **Unclosed interpolations**: Missing `}` in `${...}` expressions
- **Unresolvable references**: Interpolation paths that can't be found in indexed configs
- **Unknown resolvers**: Hints when a resolver is not a known built-in
- **Missing value markers**: Warnings for `???` values that need to be set

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `hydra.configSearchPaths` | `["conf", "config", "configs"]` | Directories to search for Hydra config files |
| `hydra.enableDiagnostics` | `true` | Enable lint diagnostics for OmegaConf errors |
| `hydra.enableHover` | `true` | Enable hover information for interpolations |

## Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Run unit tests
npm run test:unit

# Lint
npm run lint

# Package extension
npm run package
```

## Testing

The extension has comprehensive tests covering:

- **Interpolation parser**: 25+ tests for `${...}` parsing, nested interpolations, resolvers, edge cases
- **YAML parser**: 25+ tests for flattening, key path extraction, defaults list parsing
- **TextMate grammar**: 18+ structural tests validating completeness of all grammar patterns
- **Test fixtures**: Complete Hydra config workspace with realistic configs

## License

MIT
