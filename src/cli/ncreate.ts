import path from "path";
import ora from "ora";
import { Command } from "commander";
import { N8nClient } from "../services/N8nClient.js";
import { ValidationError } from "../errors/index.js";
import {
  ProjectMetadata,
  ensureProjectDir,
  fileExists,
  readJsonFile,
  resolveProjectMetadataFilePath,
  writeJsonFile,
} from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { resolveRuntimeConfig } from "../utils/runtime.js";

interface InitCommandOptions {
  force?: boolean;
  profile?: string;
}

export function registerNCreateCommand(program: Command): void {
  program
    .command("create")
    .alias("init")
    .argument("<workflow_id_source>", "Workflow ID in the configured source instance")
    .argument(
      "[project_root]",
      "Base directory where project folder will be created",
      ".",
    )
    .option("--force", "Re-initialize project.json when it already exists")
    .option("--profile <name>", "Use a named profile from ~/.ndeploy/profiles.json")
    .description("Create project from source workflow and write project.json (deprecated alias: init)")
    .action(
      async (
        workflowIdSource: string,
        projectRoot: string,
        options: InitCommandOptions,
      ) => {
      const spinner = ora("Preparing project initialization").start();
      try {
        const runtime = await resolveRuntimeConfig({ profile: options.profile });
        const sourceClient = new N8nClient(runtime.source.url, runtime.source.apiKey);
        const workflow = await sourceClient.getWorkflowById(workflowIdSource);
        const projectName = normalizeProjectName(workflow.name);
        const projectDir = path.resolve(process.cwd(), projectRoot, projectName);
        const project = path.relative(process.cwd(), projectDir) || ".";

        await ensureProjectDir(projectDir);
        const metadataPath = resolveProjectMetadataFilePath(project);
        const alreadyInitialized = await fileExists(metadataPath);

        if (alreadyInitialized && options.force !== true) {
          throw new ValidationError(
            `Project "${project}" already initialized. Use --force to re-initialize.`,
          );
        }

        const now = new Date().toISOString();
        const existingMetadata = alreadyInitialized
          ? await tryReadProjectMetadata(metadataPath)
          : null;
        const deployProfile = options.profile?.trim()
          ? runtime.profileName
          : (existingMetadata?.deploy?.profile ?? runtime.profileName);
        const metadata: ProjectMetadata = {
          schema_version: 1,
          project,
          name: projectName,
          plan: {
            root_workflow_id_source: workflow.id,
            root_workflow_name: workflow.name,
            updated_at: now,
          },
          deploy: {
            profile: deployProfile,
            updated_at: deployProfile ? now : null,
          },
          created_at: existingMetadata?.created_at ?? now,
          updated_at: now,
        };

        await writeJsonFile(metadataPath, metadata);

        if (alreadyInitialized) {
          spinner.succeed("Project re-initialized");
          logger.warn(`[NCREATE] Project re-initialized: ${projectDir}`);
        } else {
          spinner.succeed("Project initialized");
          logger.success(`[NCREATE] Project initialized: ${projectDir}`);
        }
        logger.info(`[NCREATE] root_workflow_id=${workflow.id}`);
        logger.info(`[NCREATE] root_workflow_name=${workflow.name}`);
        logger.success(`[NCREATE] Metadata file: ${metadataPath}`);
      } catch (error) {
        if (spinner.isSpinning) {
          spinner.fail("Project initialization failed");
        }
        throw error;
      }
    });
}

async function tryReadProjectMetadata(metadataPath: string): Promise<ProjectMetadata | null> {
  try {
    const metadata = await readJsonFile<ProjectMetadata>(metadataPath);
    return metadata;
  } catch {
    return null;
  }
}

function normalizeProjectName(workflowName: string): string {
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
