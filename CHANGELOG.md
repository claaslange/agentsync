# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Liquid templating via `liquidjs`, including `{% if %}`, `{% for %}`, and `{% include %}`.
- Default config file name `agentsync.config.json` and schema file name `agentsync.schema.json`.
- Schema location is now `src/agentsync.schema.json` (previously `src/agents-sync.schema.json`) and on GitHub at `https://raw.githubusercontent.com/claaslange/agentsync/main/src/agentsync.schema.json`.

### Changed
- `--strict` now enables Liquid strict variables (undefined variables throw).
- `dry-run` / `check` now enforce `overwrite=false` consistently with `sync`.

### Fixed
- Publishing workflow reliability by committing `package-lock.json` for `npm ci`.

## [0.1.0] - 2026-02-21

### Added
- Initial release.
