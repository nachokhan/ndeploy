import path from "path";
import ora from "ora";
import { Command } from "commander";
import { N8nClient } from "../services/N8nClient.js";
import { ValidationError } from "../errors/index.js";
import { loadEnv } from "../utils/env.js";
import {
  WorkspaceMetadata,
  ensureWorkspaceDir,
  fileExists,
  readJsonFile,
  resolveWorkspaceMetadataFilePath,
  writeJsonFile,
} from "../utils/file.js";
import { logger } from "../utils/logger.js";

interface CreateCommandOptions {
  force?: boolean;
}

export function registerNCreateCommand(program: Command): void {
  program
    .command("create")
    .argument("<workflow_id_dev>", "Workflow ID in DEV")
    .argument(
      "[workspace_root]",
      "Base directory where workspace folder will be created",
      ".",
    )
    .option("--force", "Re-initialize workspace.json when it already exists")
    .description("Create workspace from DEV workflow and initialize workspace.json")
    .action(
      async (
        workflowIdDev: string,
        workspaceRoot: string,
        options: CreateCommandOptions,
      ) => {
      const spinner = ora("Preparing workspace creation").start();
      try {
        const env = loadEnv();
        const devClient = new N8nClient(env.N8N_DEV_URL, env.N8N_DEV_API_KEY);
        const workflow = await devClient.getWorkflowById(workflowIdDev);
        const workspaceName = normalizeWorkspaceName(workflow.name);
        const workspaceDir = path.resolve(process.cwd(), workspaceRoot, workspaceName);
        const workspace = path.relative(process.cwd(), workspaceDir) || ".";

        await ensureWorkspaceDir(workspaceDir);
        const metadataPath = resolveWorkspaceMetadataFilePath(workspace);
        const alreadyInitialized = await fileExists(metadataPath);

        if (alreadyInitialized && options.force !== true) {
          throw new ValidationError(
            `Workspace "${workspace}" already initialized. Use --force to re-initialize.`,
          );
        }

        const now = new Date().toISOString();
        const existingMetadata = alreadyInitialized
          ? await tryReadWorkspaceMetadata(metadataPath)
          : null;
        const metadata: WorkspaceMetadata = {
          schema_version: 1,
          workspace,
          name: workspaceName,
          plan: {
            root_workflow_id_dev: workflow.id,
            root_workflow_name: workflow.name,
            updated_at: now,
          },
          created_at: existingMetadata?.created_at ?? now,
          updated_at: now,
        };

        await writeJsonFile(metadataPath, metadata);

        if (alreadyInitialized) {
          spinner.succeed("Workspace re-initialized");
          logger.warn(`[NCREATE] Workspace re-initialized: ${workspaceDir}`);
        } else {
          spinner.succeed("Workspace created");
          logger.success(`[NCREATE] Workspace created: ${workspaceDir}`);
        }
        logger.info(`[NCREATE] root_workflow_id=${workflow.id}`);
        logger.info(`[NCREATE] root_workflow_name=${workflow.name}`);
        logger.success(`[NCREATE] Metadata file: ${metadataPath}`);
      } catch (error) {
        if (spinner.isSpinning) {
          spinner.fail("Workspace creation failed");
        }
        throw error;
      }
    });
}

async function tryReadWorkspaceMetadata(metadataPath: string): Promise<WorkspaceMetadata | null> {
  try {
    const metadata = await readJsonFile<WorkspaceMetadata>(metadataPath);
    return metadata;
  } catch {
    return null;
  }
}

function normalizeWorkspaceName(workflowName: string): string {
  const sanitized = workflowName
    .trim()
    .replaceAll(/[\\/]/g, "-")
    .replaceAll(/\s+/g, "-")
    .replaceAll(/[^a-zA-Z0-9._-]/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "");

  if (!sanitized) {
    throw new ValidationError("Workflow name cannot be converted into a valid folder name");
  }
  return sanitized;
}
