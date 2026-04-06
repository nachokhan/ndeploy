<p align="center">
  <img src="./img/ndploy-cover.png" alt="ndeploy cover" />
</p>

# ndeploy

Deterministic, idempotent TypeScript CLI to plan and apply **n8n** workflow deployments from **DEV -> PROD**.

## License

This project is licensed under **Business Source License 1.1**. Professional
services and internal business use are allowed, including paid n8n consulting
and workflow delivery, but creating or monetizing a product, hosted service,
SaaS, white-label, OEM, or commercial bundle based substantially on this
project is not allowed. See [`LICENSE`](./LICENSE).

## Installation Guide

This is the fastest way to get `ndeploy` running for any user on macOS, Linux, or Ubuntu servers.

### 1) Requirements

- Node.js `>= 18`
- npm
- API access to DEV and PROD n8n instances

Check your Node version:

```bash
node -v
```

### 2) Fresh Install

Clone the repository, install dependencies, build the CLI, and link it globally:

```bash
git clone https://github.com/nachokhan/n8n-ndeploy.git ndeploy
cd n8n-ndeploy
npm install
npm run build
chmod +x dist/index.js
sudo npm link
ndeploy --help
```

If `ndeploy --help` prints the command list, the CLI is ready to use.

### 3) Update an Existing Install

If the project is already installed on a server, update it like this:

```bash
cd /your/ndeploy/folder
git pull
npm run build
chmod +x dist/index.js
sudo npm link
ndeploy --help
```

This is enough after pulling new changes, even on Ubuntu, as long as the server is running Node.js 18 or newer.

### 4) Configure Environment Variables

Create `.env` (or copy from `.env.example`):

```env
N8N_DEV_URL=http://localhost:5678
N8N_DEV_API_KEY=dev_api_key
N8N_PROD_URL=http://localhost:5679
N8N_PROD_API_KEY=prod_api_key
# Optional fallback for credentials fill:
# N8N webhook endpoint that returns credential data by requested ids
N8N_DEV_CREDENTIAL_EXPORT_URL=
# Bearer token for that endpoint
N8N_DEV_CREDENTIAL_EXPORT_TOKEN=
# Optional fallback when fetching target credential snapshots
N8N_PROD_CREDENTIAL_EXPORT_URL=
N8N_PROD_CREDENTIAL_EXPORT_TOKEN=
```

### 5) First Smoke Test

Run:

```bash
ndeploy --help
```

Then you can start with:

```bash
ndeploy init <workflow_id_dev> [project_root]
```

## Did this app help you?
If this app was useful to you, you can buy me a flat white or expresso as a thank you.

[![Buy me a cortadito](https://cdn.cafecito.app/imgs/buttons/button_6.svg)](https://cafecito.app/nachokhan)

## Documentation Languages

- English (official): `README.md`
- Spanish (secondary): [`README.es.md`](./README.es.md)
- German: [`README.de.md`](./README.de.md)

## What It Does

- Recursively discovers workflow dependencies:
  - sub-workflows
  - credentials
  - data tables
- Generates a reproducible deployment plan JSON.
- Applies the plan in PROD with `DEV_ID -> PROD_ID` mapping.
- Patches internal workflow references without global string replacements.
- Auto-publishes sub-workflows when needed.
- Never auto-publishes the root workflow (manual human action only).

## At a Glance

![Ndeploy professional guide](./img/ndeploy_guide.png)

## Commands

### 1) Init Project

```bash
ndeploy init <workflow_id_dev> [project_root]
```

Creates the project directory from the DEV workflow name and initializes `project.json`.
Optional `project_root` lets you choose where that folder is created (default: current directory).
Use `--force` to re-initialize metadata if the target project already exists.

### 2) Generate Plan

```bash
ndeploy plan <project>
```

Uses the root workflow configured in `<project>/project.json`.
Creates:
- `<project>/plan.json`
- `<project>/reports/plan_summary.json`

If `plan.json` already exists, it's backed up as `plan_backup_<timestamp>.json`.

`ndeploy init` stores root workflow information in `project.json`:
- `plan.root_workflow_id_dev`
- `plan.root_workflow_name`
- `plan.updated_at`

### 3) Apply Plan

```bash
ndeploy apply <project>
```

Executes the plan in PROD (credentials, data tables, workflows).
Writes:
- `<project>/reports/deploy_result.json`
- `<project>/reports/deploy_summary.json`

If deployment fails mid-run, partial result files are still written.

Force workflow updates even when PROD already matches:

```bash
ndeploy apply <project> --force-update
```

### 4) Manual Publish

```bash
ndeploy publish <workflow_id_prod>
```

Manual publish command for root workflow (or any workflow) in PROD.

### 5) Project Info

```bash
ndeploy info <project>
```

Shows project status in JSON:
- `project.json` metadata
- `plan.json` / `reports/plan_summary.json` / `credentials_manifest.json` presence and key metadata
- `reports/deploy_result.json` / `reports/deploy_summary.json` presence and key counters

Optional:

```bash
ndeploy info <project> --output <file_path>
```

### 6) Remove Resources

```bash
ndeploy remove --workflows <ids|all> --credentials <ids|all> --data-tables <ids|all>
```

Removes selected resources from PROD.

- IDs use CSV format: `id1,id2,id3`
- Alias: `--datatables` (same as `--data-tables`)
- Shortcut for everything: `--all`
- `--archived-workflows` limits workflow deletion to archived workflows only
- Confirmation behavior:
  - with `--yes`: executes immediately
  - without `--yes`: asks to type `yes` interactively in console

Examples:

```bash
ndeploy remove --workflows 12,18 --yes
ndeploy remove --workflows all --archived-workflows --yes
ndeploy remove --credentials all --data-tables all
ndeploy remove --all --yes
```

### 7) Find Orphans

```bash
ndeploy orphans <project> --side <source|target>
```

Lists entities not referenced by any non-archived workflow and prints pretty JSON.

- `--side` is required:
  - `source` -> uses `N8N_DEV_*`
  - `target` -> uses `N8N_PROD_*`
- Entity filters:
  - `--workflows`
  - `--credentials`
  - `--data-tables` (alias: `--datatables`)
  - `--all`
- If no entity filter is provided, it defaults to `--all`.
- Default output file (if `--output` is omitted): `<project>/reports/orphans_<side>.json`

Examples:

```bash
ndeploy orphans <project> --side target
ndeploy orphans <project> --side source --credentials
ndeploy orphans <project> --side target --workflows --datatables
```

### 8) Find Dangling References

```bash
ndeploy dangling-refs <project> --side <source|target>
```

Lists workflows that reference entities which no longer exist.

- `--side` is required:
  - `source` -> uses `N8N_DEV_*`
  - `target` -> uses `N8N_PROD_*`
- Reference filters:
  - `--workflows`
  - `--credentials`
  - `--data-tables` (alias: `--datatables`)
  - `--all`
- If no reference filter is provided, it defaults to `--all`.
- Alias command: `ndeploy dangling`
- Default output file (if `--output` is omitted): `<project>/reports/dangling_<side>.json`

Examples:

```bash
ndeploy dangling-refs <project> --side target
ndeploy dangling <project> --side source --credentials
ndeploy dangling-refs <project> --side target --workflows --datatables
```

### 9) Fetch Credential Snapshots

```bash
ndeploy credentials fetch <project>
```

Fetches full source/target snapshots for the current project dependency graph and writes:
- `<project>/credentials_source.json`
- `<project>/credentials_target.json`

Optional:

```bash
ndeploy credentials fetch <project> --side source
ndeploy credentials fetch <project> --side target
ndeploy credentials fetch <project> --side both
```

### 10) Merge Missing Credentials Into The Manifest

```bash
ndeploy credentials merge-missing <project>
```

Creates or updates `<project>/credentials_manifest.json` by adding only credentials that are still missing from the editable manifest.

- Existing manifest entries are never overwritten.
- `--side source`: seed missing entries from `credentials_source.json`.
- `--side target`: seed missing entries from `credentials_target.json`.
- `--side both` (default): use target first, then source as fallback.

### 11) Compare Source And Target

```bash
ndeploy credentials compare <project>
```

Compares `credentials_source.json` and `credentials_target.json` and reports:
- `identical`
- `different`
- `missing_in_source`
- `missing_in_target`
- `type_mismatch`

Optional:

```bash
ndeploy credentials compare <project> --format table
ndeploy credentials compare <project> --strict
```

### 12) Validate Credential Artifacts

```bash
ndeploy credentials validate <project>
```

Validates required fields in one credential artifact at a time.
The default side is `manifest`.

Optional:

```bash
ndeploy credentials validate <project> --side source
ndeploy credentials validate <project> --side target
ndeploy credentials validate <project> --side manifest
ndeploy credentials validate <project> --side all --strict
ndeploy credentials validate <project> --output <file_path>
```

## Recommended Flow

1. `ndeploy init <workflow_id_dev> [project_root]`
2. `ndeploy plan <project>`
3. Review `reports/plan_summary.json` (and `plan.json` if needed).
4. Fetch snapshots: `ndeploy credentials fetch <project>`
5. Compare source and target: `ndeploy credentials compare <project>`
6. Merge missing entries into the manifest: `ndeploy credentials merge-missing <project>`
7. Review/adjust `credentials_manifest.json` for PROD values.
8. Validate the manifest: `ndeploy credentials validate <project> --side manifest --strict`
9. `ndeploy apply <project>`
10. Review `reports/deploy_summary.json` (and `reports/deploy_result.json` if needed).
11. Human/manual publish of root workflow:
   - `ndeploy publish <root_workflow_id_prod>`

## Important Behavior

- Idempotency:
  - Resources are matched in PROD by name whenever possible.
- Credentials:
  - `credentials_source.json` and `credentials_target.json` are fetched snapshots.
  - `credentials_manifest.json` is the editable deploy manifest.
  - `ndeploy credentials merge-missing` only adds missing entries and never overwrites manual edits.
  - `ndeploy credentials compare` is informational and does not modify files.
- Data tables:
  - Created/mapped by name.
  - Schema mismatch adds warnings in the plan.
- Workflows:
  - Write payloads are sanitized to comply with n8n public API schema.
  - Before execution, DEV freshness is validated for all workflow actions (`payload.checksum`).
  - Workflow actions include informative `observability` fields in the plan:
    - `prod_comparison_at_plan`: `equal|different|unknown|not_applicable`
    - `comparison_reason`: reason for the observed result at plan generation time.
  - Plan observability is a point-in-time snapshot; `apply` remains the source of truth for final `UPDATE` vs `SKIP`.
  - Equivalence comparison ignores non-functional metadata (for example `node.position`, `node.id`, `credentials.*.name`, `staticData`) to reduce false positives.
  - `UPDATE` actions are skipped when normalized PROD content is already equivalent.
  - `--force-update` disables skip logic and always executes workflow updates.
  - ID patching targets:
    - `node.credentials.*.id`
    - `parameters.workflowId`
    - `parameters.dataTableId` / `parameters.tableId`
    - `settings.errorWorkflow`
- Publishing policy:
  - Sub-workflows can be auto-published during `apply`.
  - Root workflow is never auto-published.

## Logging

Detailed step logging is included:

- Plan: `[PLAN][..]`
- Deploy: `[DEPLOY][VAL][..]` and `[DEPLOY][RUN][..]`
- API client: `[N8N_CLIENT]`

This makes failures traceable by phase, entity, and API response context.

## Useful Scripts

```bash
npm run dev -- --help
npm run typecheck
npm run build
```

## Project Structure

```text
src/
  cli/            # create/plan/apply/publish/info/remove/orphans/dangling commands
  services/       # API, planning, deploy, transforms
  types/          # Zod schemas + TS types
  utils/          # env, logger, hash, file helpers
  errors/         # ApiError / DependencyError / ValidationError
```

## Quick Troubleshooting

- `must have required property 'connections'`:
  - Plan was generated with incomplete workflow payload; regenerate plan.
- `must NOT have additional properties`:
  - Workflow/settings payload includes unsupported fields.
- `referenced workflow ... is not published`:
  - A called sub-workflow in PROD is not published yet.
- `405 GET method not allowed` on credentials:
  - n8n does not support `GET /credentials/{id}`; use list + resolve.
