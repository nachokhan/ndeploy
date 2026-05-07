import { ValidationError } from "../errors/index.js";
import {
  fileExists,
  ProjectMetadata,
  readJsonFile,
  resolveProjectDir,
  resolveProjectMetadataFilePath,
} from "./file.js";

export function resolveProjectArg(project?: string): string {
  return project?.trim() ? project : ".";
}

export async function ensureProjectExists(project?: string): Promise<string> {
  const resolvedProject = resolveProjectArg(project);
  const projectDir = resolveProjectDir(resolvedProject);
  const projectExists = await fileExists(projectDir);
  if (!projectExists) {
    throw new ValidationError(
      `Project "${resolvedProject}" does not exist at ${projectDir}. Run: ndeploy create <workflow_id_source> [project_root]`,
    );
  }
  return resolvedProject;
}

export async function readRequiredProjectMetadata(project?: string): Promise<{
  project: string;
  metadataPath: string;
  metadata: ProjectMetadata;
}> {
  const resolvedProject = await ensureProjectExists(project);
  const metadataPath = resolveProjectMetadataFilePath(resolvedProject);
  const metadataExists = await fileExists(metadataPath);
  if (!metadataExists) {
    throw new ValidationError(
      `Project "${resolvedProject}" is not initialized. Missing ${metadataPath}. Run: ndeploy create <workflow_id_source> [project_root]`,
    );
  }

  return {
    project: resolvedProject,
    metadataPath,
    metadata: validateProjectMetadata(
      await readJsonFile<ProjectMetadata>(metadataPath),
      resolvedProject,
      metadataPath,
    ),
  };
}

function validateProjectMetadata(
  metadata: ProjectMetadata,
  project: string,
  metadataPath: string,
): ProjectMetadata {
  if (!metadata.plan) {
    throw new ValidationError(
      `Project "${project}" metadata is missing "plan" configuration in ${metadataPath}. Run: ndeploy create <workflow_id_source> [project_root] --force`,
    );
  }

  return metadata;
}
