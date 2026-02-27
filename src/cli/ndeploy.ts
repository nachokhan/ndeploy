import ora from "ora";
import { Command } from "commander";
import { N8nClient } from "../services/N8nClient.js";
import { DeployService } from "../services/DeployService.js";
import { TransformService } from "../services/TransformService.js";
import { readJsonFile } from "../utils/file.js";
import { loadEnv } from "../utils/env.js";
import { logger } from "../utils/logger.js";

export function registerNDeployCommand(program: Command): void {
  program
    .command("ndeploy")
    .argument("<plan_file_path>", "Path to plan JSON")
    .description("Execute deployment plan in PROD")
    .action(async (planFilePath: string) => {
      const validateSpinner = ora("Validating plan and DEV checksum").start();
      try {
        const env = loadEnv();
        const devClient = new N8nClient(env.N8N_DEV_URL, env.N8N_DEV_API_KEY);
        const prodClient = new N8nClient(env.N8N_PROD_URL, env.N8N_PROD_API_KEY);
        const service = new DeployService(devClient, prodClient, new TransformService());

        const rawPlan = await readJsonFile<unknown>(planFilePath);
        const plan = await service.validatePlan(rawPlan);

        validateSpinner.succeed("Plan is valid");

        const deploySpinner = ora(`Executing ${plan.actions.length} actions`).start();
        await service.executePlan(plan);
        deploySpinner.succeed("Deployment completed successfully");
      } catch (error) {
        validateSpinner.fail("Deployment failed");
        throw error;
      }
    });

  logger.debug("Command ndeploy registered");
}
