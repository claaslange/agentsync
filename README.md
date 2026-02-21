# agentsync

Sync one canonical agent-instructions template to multiple harness-specific “global instructions” file locations.

## What it does

- You keep a single template file (default: `~/.agentsync/AGENTS_TEMPLATE.md`).
- You define multiple targets in a single config file (default: `~/.agentsync/agentsync.config.json`).
- `agentsync` renders the template for each target and writes it to the configured destination paths.

## Install

Global install (npm):

```bash
npm i -g @claaslange/agentsync
agentsync help
```

Global install (Bun):

```bash
bun add -g @claaslange/agentsync
agentsync help
```

## Quickstart

Copy the example files:

```bash
mkdir -p ~/.agentsync
cp ./example/agentsync.config.json ~/.agentsync/agentsync.config.json
cp ./example/AGENTS_TEMPLATE.md ~/.agentsync/AGENTS_TEMPLATE.md
```

Run a dry-run:

```bash
agentsync dry-run
```

Apply:

```bash
agentsync sync
```

## Config

High-level shape:

- `targets` is an array of `{ agent, path, enabled?, variables? }`.
- `variables` is per-target (there are no global variables).

Minimal example:

```json
{
  "$schema": "https://raw.githubusercontent.com/claaslange/agentsync/main/src/agentsync.schema.json",
  "template_path": "AGENTS_TEMPLATE.md",
  "targets": [
    { "agent": "codex", "path": "~/.codex/AGENTS.md" },
    { "agent": "claude_code", "path": "~/.claude/CLAUDE.md", "enabled": false },
    { "agent": "github_copilot", "path": "~/.copilot/copilot-instructions.md", "variables": { "AGENT_NAME": "GitHub Copilot" } }
  ]
}
```

Editor validation / autocomplete:

- Add a `$schema` key to your config, e.g. `https://raw.githubusercontent.com/claaslange/agentsync/main/src/agentsync.schema.json`.

Built-in template variables (available for every target):

- `AGENT_NAME` (defaults to the target’s `agent`)
- `TARGET_PATH` (resolved destination path)
- `TEMPLATE_PATH` (resolved template path)
- `RUN_TIMESTAMP` (UTC timestamp)

## Templating (Liquid)

Templates are rendered using Liquid (via `liquidjs`).

- Output variables: `{{ AGENT_NAME }}`
- Control flow: `{% if ... %}...{% endif %}`, `{% for x in xs %}...{% endfor %}`
- Includes: `{% include "partials/common.md" %}` (searched relative to the template directory, then the config directory)
- `--strict` enables strict variables (undefined variables throw; useful for CI)

## Usage

- `agentsync` (no args) shows help.
- When run with no `--config`, `agentsync` looks for:
  - `~/.agentsync/agentsync.config.json`
  - `./agentsync.config.json`
- When run with no `--template`, `agentsync` uses:
  - `config.template_path` (when present), otherwise
  - `~/.agentsync/AGENTS_TEMPLATE.md`
- Your config should typically reference the template next to it, e.g. `"template_path": "AGENTS_TEMPLATE.md"`.

Check mode (CI-friendly; exits 1 if anything would change):

```bash
agentsync check
```

## Repo files

- `example/AGENTS_TEMPLATE.md` — example template.
- `example/agentsync.config.json` — example config.
- `src/agentsync.schema.json` — JSON Schema used by the CLI.
- `src/cli.ts` / `bin/agentsync` — the sync CLI.

## Publishing (maintainers)

This repo publishes via GitHub Actions on tags that match `vX.Y.Z` (integers). To publish:

- Update `package.json` `version` to `X.Y.Z`.
- Push a matching tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
- Configure npm Trusted Publishing for this repo/workflow (OIDC). No `NPM_TOKEN` secret is needed once set up.
