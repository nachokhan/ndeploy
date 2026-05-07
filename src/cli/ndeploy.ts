import ora from "ora";
import { Command } from "commander";
import { N8nClient } from "../services/N8nClient.js";
import { DeployService } from "../services/DeployService.js";
import { DeploySummaryService } from "../services/DeploySummaryService.js";
import { TransformService } from "../services/TransformService.js";
import { CredentialsManifestEntry, CredentialsManifestFile } from "../types/credentials.js";
import {
  fileExists,
  readJsonFile,
  resolveProjectCredentialsManifestFilePath,
  resolveProjectDeployResultFilePath,
  resolveProjectDeploySummaryFilePath,
  resolveProjectPlanFilePath,
  writeJsonFile,
} from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { ApiError, ValidationError } from "../errors/index.js";
import { readRequiredProjectMetadata } from "../utils/project.js";
import { resolveRuntimeConfig } from "../utils/runtime.js";

export function registerNDeployCommand(program: Command): void {
  program
    .command("apply")
    .argument("[project]", "Project directory (defaults to current directory)")
    .option(
      "--force-update",
      "Always execute workflow UPDATE actions, even when target content is already equivalent",
    )
    .option("--profile <name>", "Override project profile for this run")
    .description("Execute project/plan.json deployment plan in the configured target instance")
    .action(async (projectArg: string | undefined, options: { forceUpdate?: boolean; profile?: string }) => {
      const validateSpinner = ora("Preparing ndeploy execution").start();
      let deploySpinner: ReturnType<typeof ora> | null = null;
      let service: DeployService | null = null;
      let project = projectArg ?? ".";
      let projectMetadata;
      try {
        ({ project, metadata: projectMetadata } = await readRequiredProjectMetadata(projectArg));
        const runtime = await resolveRuntimeConfig({
          profile: options.profile,
          projectMetadata,
        });
        validateSpinner.succeed("Environment loaded");
        const planFilePath = resolveProjectPlanFilePath(project);
        logger.info(`[NDEPLOY] project=${project}`);
        logger.info(`[NDEPLOY] plan_file=${planFilePath}`);
        logger.info(`[NDEPLOY] force_update=${options.forceUpdate === true}`);
        logger.debug(`[NDEPLOY] source=${runtime.source.url} target=${runtime.target.url}`);
        if (runtime.profileName) {
          logger.info(`[NDEPLOY] profile=${runtime.profileName}`);
        }

        const sourceClient = new N8nClient(runtime.source.url, runtime.source.apiKey);
        const targetClient = new N8nClient(runtime.target.url, runtime.target.apiKey);
        service = new DeployService(sourceClient, targetClient, new TransformService(), {
          forceUpdate: options.forceUpdate === true,
        });
        const summaryService = new DeploySummaryService();

        logger.info("[NDEPLOY] Reading plan file");
        const rawPlan = await readJsonFile<unknown>(planFilePath);
        logger.info("[NDEPLOY] Validating plan");
        const plan = await service.validatePlan(rawPlan);

        logger.success(
          `[NDEPLOY] Plan valid plan_id=${plan.metadata.plan_id} actions=${plan.actions.length}`,
        );

        const credentialsManifestBySourceId = await readCredentialsManifestForApply(project, plan.actions);
        deploySpinner = ora(`Executing ${plan.actions.length} actions`).start();
        const result = await service.executePlanWithResult(plan, project, credentialsManifestBySourceId);
        const resultFile = resolveProjectDeployResultFilePath(project);
        const summaryFile = resolveProjectDeploySummaryFilePath(project);
        await writeJsonFile(resultFile, result);
        await writeJsonFile(summaryFile, summaryService.buildSummary(result));
        logger.success(`Deploy result file: ${resultFile}`);
        logger.success(`Deploy summary file: ${summaryFile}`);
        deploySpinner.succeed("Deployment completed successfully");
      } catch (error) {
        const runResult = service?.getLastDeployResult() ?? null;
        if (runResult) {
          try {
            const summaryService = new DeploySummaryService();
            const resultFile = resolveProjectDeployResultFilePath(project);
            const summaryFile = resolveProjectDeploySummaryFilePath(project);
            await writeJsonFile(resultFile, runResult);
            await writeJsonFile(summaryFile, summaryService.buildSummary(runResult));
            logger.warn(`[NDEPLOY] Partial deploy result file written: ${resultFile}`);
            logger.warn(`[NDEPLOY] Partial deploy summary file written: ${summaryFile}`);
          } catch (persistError) {
            const persistFallback = persistError as Error;
            logger.error(`[NDEPLOY] Failed to persist deploy result files: ${persistFallback.message}`);
          }
        }
        if (deploySpinner?.isSpinning) {
          deploySpinner.fail("Deployment failed during action execution");
        } else if (validateSpinner.isSpinning) {
          validateSpinner.fail("Deployment failed");
        } else {
          logger.error("[NDEPLOY] Deployment failed");
        }
        if (error instanceof ApiError) {
          logger.error(`[NDEPLOY] ApiError: ${error.message}`);
          if (error.context) {
            logger.error(`[NDEPLOY] context=${JSON.stringify(error.context, null, 2)}`);
          }
        } else if (error instanceof ValidationError) {
          logger.error(`[NDEPLOY] ValidationError: ${error.message}`);
          if (error.details) {
            logger.error(`[NDEPLOY] details=${JSON.stringify(error.details, null, 2)}`);
          }
        } else {
          const fallback = error as Error;
          logger.error(`[NDEPLOY] Error: ${fallback.message}`);
        }
        throw error;
      }
    });

  logger.debug("Command apply registered");
}

async function readCredentialsManifestForApply(
  project: string,
  actions: Array<{ type: string; action: string }>,
): Promise<Map<string, CredentialsManifestEntry> | null> {
  const requiresCredentialCreation = actions.some(
    (action) => action.type === "CREDENTIAL" && action.action === "CREATE",
  );
  if (!requiresCredentialCreation) {
    return null;
  }

  const manifestPath = resolveProjectCredentialsManifestFilePath(project);
  const manifestExists = await fileExists(manifestPath);
  if (!manifestExists) {
    throw new ValidationError(
      `Missing ${manifestPath}. Run: ndeploy credentials fetch <project> && ndeploy credentials merge-missing <project>`,
    );
  }

  const manifest = await readJsonFile<Partial<CredentialsManifestFile>>(manifestPath);
  if (!manifest.metadata || !Array.isArray(manifest.credentials)) {
    throw new ValidationError(`Invalid credentials manifest format in ${manifestPath}.`);
  }

  return new Map(manifest.credentials.map((credential) => [credential.source_id, credential]));
}
