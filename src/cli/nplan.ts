import ora from "ora";
import { Command } from "commander";
import { N8nClient } from "../services/N8nClient.js";
import { PlanService } from "../services/PlanService.js";
import { loadEnv } from "../utils/env.js";
import { logger } from "../utils/logger.js";
import { resolvePlanFileName, writeJsonFile } from "../utils/file.js";

export function registerNPlanCommand(program: Command): void {
  const nplan = new Command("nplan");

  nplan
    .command("flow")
    .argument("<workflow_id_dev>", "Workflow ID in DEV")
    .description("Generate deployment plan from DEV workflow and dependencies")
    .action(async (workflowIdDev: string) => {
      const spinner = ora("Generating deployment plan").start();
      try {
        const env = loadEnv();
        const devClient = new N8nClient(env.N8N_DEV_URL, env.N8N_DEV_API_KEY);
        const prodClient = new N8nClient(env.N8N_PROD_URL, env.N8N_PROD_API_KEY);
        const service = new PlanService(devClient, prodClient, env.N8N_DEV_URL, env.N8N_PROD_URL);

        const plan = await service.buildPlan(workflowIdDev);
        const outputFile = resolvePlanFileName(workflowIdDev);
        await writeJsonFile(outputFile, plan);

        spinner.succeed("Plan generated successfully");
        logger.success(`Plan file: ${outputFile}`);
      } catch (error) {
        spinner.fail("Plan generation failed");
        throw error;
      }
    });

  program.addCommand(nplan);
}
