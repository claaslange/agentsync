# agents

This folder contains a small tool to keep **one canonical agent-instructions template** and sync it to the various global instruction locations required by different agentic coding harnesses (Codex, Claude Code, Copilot, etc.).

## Goals

- Keep instructions in a single template (default: `~/.agentsync/AGENTS_TEMPLATE.md`) and a single config (default: `~/.agentsync/agents-sync.json`).
- Make syncing deterministic and safe (idempotent writes, optional backups, explicit enable/disable per target).
- Keep the runtime dependency-free (no third-party deps).
- Ship as an npm package (`@claaslange/agentsync`) installable via npm or bun.

## Template variables

`agentsync` replaces variables in the template using each target’s `variables` object.

Supported placeholder forms:

- `{{VAR_NAME}}`
- `${VAR_NAME}`

The CLI also injects built-ins (can be overridden by a target’s `variables`):

- `AGENT_NAME` (the target’s `agent` string)
- `TARGET_PATH` (expanded destination path)
- `TEMPLATE_PATH` (resolved template path)
- `RUN_TIMESTAMP` (UTC timestamp like `20260101...`)

## Config shape

- `template_path` (optional): path to the template file; defaults to `~/.agentsync/AGENTS_TEMPLATE.md`.
- `targets` (required): array of objects `{ agent, path, enabled?, variables? }`.
- `options` (optional): supports `overwrite`, `backup`, `backup_suffix` (CLI flags/options are intentionally minimal for now).

The config is validated against the bundled JSON Schema at `src/agents-sync.schema.json`.
You can also add a `$schema` key to your config pointing at the raw GitHub URL for editor autocomplete/validation.

## Defaults / overrides

- Config path default lookup order:
  1) `~/.agentsync/agents-sync.json`
  2) `./agents-sync.json`
- Override config path via `--config <path>`.
- Override template path via `--template <path>`.
- `agentsync` (no args) shows help; `agentsync sync` performs the action; `agentsync dry-run` / `agentsync check` are convenience commands.

## Example files

- `example/AGENTS_TEMPLATE.md`
- `example/agents-sync.json`

## Publishing

- GitHub Actions publishes to npm only on tags matching `vX.Y.Z` (integers).
- The workflow also checks `package.json` version matches the tag (without the `v` prefix).

## Dev notes

- `bin/agentsync` runs via Bun in-repo, or via Node from `dist/` after `npm run build`.
- `dist/` is build output and is not committed.
