import ora from "ora";
import { Command } from "commander";
import { N8nClient } from "../services/N8nClient.js";
import { logger } from "../utils/logger.js";
import { ApiError } from "../errors/index.js";
import { resolveRuntimeConfig } from "../utils/runtime.js";

export function registerNPublishCommand(program: Command): void {
  program
    .command("publish")
    .argument("<workflow_id_target>", "Workflow ID in the configured target instance to publish")
    .option("--profile <name>", "Use a named profile from ~/.ndeploy/profiles.json")
    .description("Manually publish a workflow in the configured target instance")
    .action(async (workflowIdTarget: string, options: { profile?: string }) => {
      const spinner = ora("Publishing workflow in target instance").start();
      try {
        const runtime = await resolveRuntimeConfig({ profile: options.profile });
        const targetClient = new N8nClient(runtime.target.url, runtime.target.apiKey);

        logger.info(`[NPUBLISH] workflow_id_target=${workflowIdTarget}`);
        if (runtime.profileName) {
          logger.info(`[NPUBLISH] profile=${runtime.profileName}`);
        }
        await targetClient.activateWorkflow(workflowIdTarget);

        spinner.succeed("Workflow published");
        logger.success(`[NPUBLISH] Published workflow ${workflowIdTarget}`);
      } catch (error) {
        spinner.fail("Manual publish failed");
        if (error instanceof ApiError) {
          logger.error(`[NPUBLISH] ApiError: ${error.message}`);
          if (error.context) {
            logger.error(`[NPUBLISH] context=${JSON.stringify(error.context, null, 2)}`);
          }
        }
        throw error;
      }
    });
}
