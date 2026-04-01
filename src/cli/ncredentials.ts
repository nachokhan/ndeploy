import path from "path";
import { Command } from "commander";
import { ValidationError } from "../errors/index.js";
import {
  fileExists,
  readJsonFile,
  resolveWorkspaceDir,
  resolveWorkspaceProductionCredentialsFilePath,
  writeJsonFile,
} from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { ProductionCredentialsFile } from "../types/productionCredentials.js";

interface CredentialsValidateOptions {
  output?: string;
  strict?: boolean;
}

interface CredentialValidationItem {
  name: string;
  type: string | null;
  status: string;
  required_action: string;
  missing_required_fields: string[];
}

interface CredentialsValidationResult {
  workspace: string;
  workspace_path: string;
  production_credentials_file: string;
  generated_at: string | null;
  totals: {
    credentials: number;
    ready: number;
    missing_required_fields: number;
  };
  credentials: CredentialValidationItem[];
}

export function registerNCredentialsCommand(program: Command): void {
  const credentials = new Command("credentials");
  credentials.description("Credential-related commands");

  credentials
    .command("validate")
    .argument("<workspace>", "Workspace directory")
    .option("-o, --output <file_path>", "Write JSON report to file")
    .option("--strict", "Exit with error if missing required fields are found")
    .description("Validate required credential fields in production_credentials.json")
    .action(async (workspace: string, options: CredentialsValidateOptions) => {
      const workspacePath = resolveWorkspaceDir(workspace);
      const workspaceExists = await fileExists(workspacePath);
      if (!workspaceExists) {
        throw new ValidationError(
          `Workspace "${workspace}" does not exist at ${workspacePath}. Run: ndeploy create <workflow_id_dev> [workspace_root]`,
        );
      }

      const credentialsFilePath = resolveWorkspaceProductionCredentialsFilePath(workspace);
      const credentialsFileExists = await fileExists(credentialsFilePath);
      if (!credentialsFileExists) {
        throw new ValidationError(
          `Missing ${credentialsFilePath}. Run: ndeploy plan <workspace>`,
        );
      }

      const file = await readJsonFile<ProductionCredentialsFile>(credentialsFilePath);
      const validationItems = file.credentials.map((credential) => {
        const required = credential.template.required_fields ?? [];
        const data = credential.template.data ?? {};
        const missingRequired = required.filter((fieldName) =>
          isMissingValue((data as Record<string, unknown>)[fieldName]),
        );
        return {
          name: credential.name,
          type: credential.type,
          status: credential.status,
          required_action: credential.required_action,
          missing_required_fields: missingRequired,
        };
      });

      const missingRequiredTotal = validationItems.reduce(
        (total, item) => total + item.missing_required_fields.length,
        0,
      );
      const readyCount = validationItems.filter((item) => item.missing_required_fields.length === 0).length;

      const result: CredentialsValidationResult = {
        workspace,
        workspace_path: workspacePath,
        production_credentials_file: credentialsFilePath,
        generated_at: file.metadata?.generated_at ?? null,
        totals: {
          credentials: validationItems.length,
          ready: readyCount,
          missing_required_fields: missingRequiredTotal,
        },
        credentials: validationItems,
      };

      if (options.output) {
        const outputPath = path.resolve(process.cwd(), options.output);
        await writeJsonFile(outputPath, result);
        logger.info(`[NCREDENTIALS] Validation report written to ${outputPath}`);
      }

      console.log(JSON.stringify(result, null, 2));

      if (missingRequiredTotal > 0) {
        logger.warn(
          `[NCREDENTIALS] Missing required fields: ${missingRequiredTotal} across ${validationItems.length} credential(s)`,
        );
        if (options.strict) {
          throw new ValidationError(
            `Credential validation failed: ${missingRequiredTotal} required field(s) missing.`,
          );
        }
      } else {
        logger.success("[NCREDENTIALS] All required credential fields are complete");
      }
    });

  program.addCommand(credentials);
  logger.debug("Command credentials registered");
}

function isMissingValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  return false;
}
