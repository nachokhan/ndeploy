# Changelog

All notable changes to this project are documented in this file.

The format follows Keep a Changelog and Semantic Versioning.

## [Unreleased]
### Added
- New profile-based runtime setup via `~/.ndeploy/profiles.json`, with optional credential export webhook configuration for both source and target instances.
- New example profile file in `profiles.example.json`.
- New end-to-end operator test guide under `docs/tech/full-source-to-target-test.md` and `docs/tech/full-source-to-target-test.html`.

### Changed
- Replaced `DEV/PROD` terminology across the CLI, generated artifacts, runtime config, and docs with `source/target`.
- Standardized project metadata and generated credential artifacts around `root_workflow_id_source`, `source_id`, and `target_id`.
- Promoted `ndeploy create` as the primary command for project initialization, keeping `ndeploy init` as a deprecated alias.
- Updated the n8n credential export fallback template and setup guide to use the source-target naming model.

### Fixed
- Credential snapshot fetch now accepts fallback webhook responses that still return `dev_id`, preserving compatibility with older n8n workflow templates.

## [3.0.0] - 2026-04-05
### Added
- New project-first flow with `ndeploy init`, `ndeploy info`, `plan_summary.json`, `deploy_summary.json`, and `deploy_result.json`.
- New credential workflow with `ndeploy credentials fetch`, `merge-missing`, `compare`, and `validate`.
- New `credentials_source.json`, `credentials_target.json`, and editable `credentials_manifest.json` artifacts.
- Optional credential fill support from source or target snapshot fetch, with export-endpoint fallback.
- Included generic n8n webhook fallback template and instructions under `n8n/` for credential export recovery.
- `ndeploy apply` now uses `credentials_manifest.json` for credential `CREATE` actions and fails fast when required fields are missing.

### Changed
- Replaced the old `workspace` concept with `project` across CLI, metadata, generated files, and documentation.
- Added `ndeploy create` as the primary project initialization command and kept `ndeploy init` as a compatibility alias.
- Planning and deployment now operate around a persisted project model instead of the previous direct plan flow.
- Generated reports moved under `project/reports` and operator docs were refreshed across README, MANUAL, and site docs.
- Replaced the previous credentials update flow with explicit snapshot/manifest commands and artifacts.
- CLI compatibility improved by pinning `ora` to v5 for Node 18 CommonJS environments.

### Fixed
- Credential fill can now fall back to an n8n endpoint when the standard API does not expose decrypted credential data.

## [2.0.0] - 2026-04-02
### Added
- New project-first flow with `ndeploy init`, `ndeploy info`, `plan_summary.json`, `deploy_summary.json`, and `deploy_result.json`.
- New credential workflow with `ndeploy credentials fetch`, `merge-missing`, `compare`, and `validate`.
- New `credentials_source.json`, `credentials_target.json`, and editable `credentials_manifest.json` artifacts.
- Optional credential fill support from source or target snapshot fetch, with export-endpoint fallback.
- Included generic n8n webhook fallback template and instructions under `n8n/` for credential export recovery.

### Changed
- Planning and deployment now operate around a persisted project model instead of the previous direct plan flow.
- Generated reports moved under `project/reports` and operator docs were refreshed across README, MANUAL, and site docs.
- CLI compatibility improved by pinning `ora` to v5 for Node 18 CommonJS environments.

### Fixed
- Credential fill can now fall back to an n8n endpoint when the standard API does not expose decrypted credential data.

## [1.4.0] - 2026-03-17
### Added
- New `--archived-workflows` filter in `ndeploy remove` to target archived workflows.
- New technical docs section under `docs/tech/` with operator-focused guides (`plan/apply`, `operations`, and `observability`).

### Changed
- Improved workflow equivalence checks in `plan` and `deploy` for observability-related fields, improving skip logic stability.
- Documentation updates in `README.md`, `README.es.md`, `README.de.md`, `MANUAL.md`, and `docs/index.html`.
- Project website docs index updated to include the GitHub repository link and technical docs navigation.

### Fixed
- Deployment now patches workflow self-references before workflow updates.
- Workflow dependency discovery now includes `settings.errorWorkflow` references in planning/dangling analysis.
- Orphan workflow detection now treats `settings.errorWorkflow` as a valid workflow reference.

## [1.3.0] - 2026-03-04
### Added
- New `ndeploy dangling-refs` command (alias: `ndeploy dangling`) to detect missing referenced entities.
- Required `--side <source|target>` option for `dangling-refs`.
- Reference filters for `dangling-refs`: `--workflows`, `--credentials`, `--data-tables`/`--datatables`, and `--all`.
- Pretty JSON output with summary and per-workflow dangling reference details.

### Changed
- Documentation updated in `README.md`, `README.es.md`, `README.de.md`, `MANUAL.md`, and `docs/index.html`.

## [1.2.0] - 2026-03-04
### Added
- New `ndeploy orphans` command to list unreferenced entities.
- Required `--side <source|target>` option for `orphans`.
- Entity filters for `orphans`: `--workflows`, `--credentials`, `--data-tables`/`--datatables`, and `--all`.
- Default behavior in `orphans` to include all entity types when no filter is provided.
- Pretty JSON output for orphans, including credential `type`.

### Changed
- Documentation updated in `README.md`, `README.es.md`, `README.de.md`, `MANUAL.md`, and `docs/index.html`.

## [1.1.0] - 2026-03-04
### Added
- New `ndeploy remove` command to remove workflows, credentials, and data tables.
- Selection options in `remove`: `--workflows`, `--credentials`, `--data-tables`/`--datatables`, and `--all`.
- Interactive safety confirmation for `remove` requiring the user to type `yes` when `--yes` is not present.
- `--yes` option to force execution without interactive prompt.
- `--dry-run` option for previewing deletions without executing.

### Changed
- Documentation updated in `README.md`, `README.es.md`, `README.de.md`, `MANUAL.md`, and `docs/index.html`.

## [1.0.0] - 2026-02-27
### Added
- Initial CLI release with `plan`, `apply`, and `publish` commands.
- Deterministic and idempotent source -> target deployment workflow for n8n.
