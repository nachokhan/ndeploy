import ora from "ora";
import { Command } from "commander";
import { N8nClient } from "../services/N8nClient.js";
import { logger } from "../utils/logger.js";
import { ApiError } from "../errors/index.js";
import { resolveRuntimeConfig } from "../utils/runtime.js";

export function registerNPublishCommand(program: Command): void {
  program
    .command("publish")
    .argument("<workflow_id_prod>", "Workflow ID in the configured target instance to publish")
    .option("--profile <name>", "Use a named profile from ~/.ndeploy/profiles.json")
    .description("Manually publish a workflow in the configured target instance")
    .action(async (workflowIdProd: string, options: { profile?: string }) => {
      const spinner = ora("Publishing workflow in target instance").start();
      try {
        const runtime = await resolveRuntimeConfig({ profile: options.profile });
        const prodClient = new N8nClient(runtime.target.url, runtime.target.apiKey);

        logger.info(`[NPUBLISH] workflow_id_prod=${workflowIdProd}`);
        if (runtime.profileName) {
          logger.info(`[NPUBLISH] profile=${runtime.profileName}`);
        }
        await prodClient.activateWorkflow(workflowIdProd);

        spinner.succeed("Workflow published");
        logger.success(`[NPUBLISH] Published workflow ${workflowIdProd}`);
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
