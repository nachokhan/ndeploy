import ora from "ora";
import { Command } from "commander";
import { N8nClient } from "../services/N8nClient.js";
import { PlanService } from "../services/PlanService.js";
import { PlanSummaryService } from "../services/PlanSummaryService.js";
import { logger } from "../utils/logger.js";
import {
  backupProjectPlanIfExists,
  ensureProjectDir,
  resolveProjectPlanFilePath,
  resolveProjectPlanSummaryFilePath,
  writeJsonFile,
} from "../utils/file.js";
import { ApiError, DependencyError, ValidationError } from "../errors/index.js";
import { readRequiredProjectMetadata } from "../utils/project.js";
import { resolveRuntimeConfig } from "../utils/runtime.js";

export function registerNPlanCommand(program: Command): void {
  const nplan = new Command("plan");

  nplan
    .argument("[project]", "Project directory (defaults to current directory)")
    .option("--profile <name>", "Override project profile for this run")
    .description("Generate deployment plan from project root workflow")
    .action(async (projectArg: string | undefined, options: { profile?: string }) => {
      const spinner = ora("Preparing nplan execution").start();
      try {
        const { project, metadataPath, metadata: projectMetadata } = await readRequiredProjectMetadata(projectArg);
        const runtime = await resolveRuntimeConfig({
          profile: options.profile,
          projectMetadata,
        });
        spinner.succeed("Environment loaded");
        const workflowIdSource = projectMetadata.plan.root_workflow_id_source;
        if (!workflowIdSource) {
          throw new ValidationError(
            `Project "${project}" has no root workflow configured. Run: ndeploy create <workflow_id_source> [project_root]`,
          );
        }
        logger.info(`[NPLAN] root_workflow_id=${workflowIdSource}`);
        logger.info(`[NPLAN] project=${project}`);
        logger.debug(`[NPLAN] source=${runtime.source.url} target=${runtime.target.url}`);
        if (runtime.profileName) {
          logger.info(`[NPLAN] profile=${runtime.profileName}`);
        }

        const sourceClient = new N8nClient(runtime.source.url, runtime.source.apiKey);
        const targetClient = new N8nClient(runtime.target.url, runtime.target.apiKey);
        const service = new PlanService(sourceClient, targetClient, runtime.source.url, runtime.target.url);
        const summaryService = new PlanSummaryService();

        logger.info("[NPLAN] Starting plan generation pipeline");
        const plan = await service.buildPlan(workflowIdSource);
        const summary = summaryService.buildSummary(plan);
        logger.info("[NPLAN] Plan generated in memory, writing JSON file");
        await ensureProjectDir(project);
        const outputFile = resolveProjectPlanFilePath(project);
        const summaryFile = resolveProjectPlanSummaryFilePath(project);
        const backupFile = await backupProjectPlanIfExists(project);
        if (backupFile) {
          logger.success(`[NPLAN] Existing plan backed up to: ${backupFile}`);
        }
        await writeJsonFile(outputFile, plan);
        await writeJsonFile(summaryFile, summary);
        const rootWorkflowAction = plan.actions.find(
          (action) => action.type === "WORKFLOW" && action.source_id === workflowIdSource,
        );
        if (rootWorkflowAction && rootWorkflowAction.name !== projectMetadata.plan.root_workflow_name) {
          const now = new Date().toISOString();
          projectMetadata.plan.root_workflow_name = rootWorkflowAction.name;
          projectMetadata.plan.updated_at = now;
          projectMetadata.updated_at = now;
          await writeJsonFile(metadataPath, projectMetadata);
          logger.success(
            `[NPLAN] Project metadata updated with root workflow name="${rootWorkflowAction.name}"`,
          );
        }

        logger.success("[NPLAN] Plan JSON persisted");
        logger.success(`Plan file: ${outputFile}`);
        logger.success(`Plan summary file: ${summaryFile}`);
        logger.info(
          `[NPLAN] Summary -> actions=${plan.actions.length}, plan_id=${plan.metadata.plan_id}`,
        );
      } catch (error) {
        if (spinner.isSpinning) {
          spinner.fail("nplan failed");
        } else {
          logger.error("[NPLAN] nplan failed");
        }
        if (error instanceof ApiError) {
          logger.error(`[NPLAN] ApiError: ${error.message}`);
          if (error.context) {
            logger.error(`[NPLAN] context=${JSON.stringify(error.context, null, 2)}`);
          }
        } else if (error instanceof DependencyError) {
          logger.error(`[NPLAN] DependencyError: ${error.message}`);
          if (error.context) {
            logger.error(`[NPLAN] context=${JSON.stringify(error.context, null, 2)}`);
          }
        } else if (error instanceof ValidationError) {
          logger.error(`[NPLAN] ValidationError: ${error.message}`);
          if (error.details) {
            logger.error(`[NPLAN] details=${JSON.stringify(error.details, null, 2)}`);
          }
        } else {
          const fallback = error as Error;
          logger.error(`[NPLAN] Error: ${fallback.message}`);
        }
        throw error;
      }
    });

  program.addCommand(nplan);
}
