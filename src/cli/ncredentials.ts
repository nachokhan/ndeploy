import path from "path";
import axios from "axios";
import { Command } from "commander";
import { N8nClient } from "../services/N8nClient.js";
import { ValidationError } from "../errors/index.js";
import { AppEnv, loadEnv } from "../utils/env.js";
import {
  ProjectMetadata,
  fileExists,
  readJsonFile,
  resolveProjectCredentialsManifestFilePath,
  resolveProjectCredentialsSourceFilePath,
  resolveProjectCredentialsTargetFilePath,
  resolveProjectDir,
  resolveProjectMetadataFilePath,
  writeJsonFile,
} from "../utils/file.js";
import { logger } from "../utils/logger.js";
import {
  CredentialManifestSeed,
  CredentialSnapshotEntry,
  CredentialSnapshotFile,
  CredentialSnapshotSide,
  CredentialTemplate,
  CredentialsManifestEntry,
  CredentialsManifestFile,
} from "../types/credentials.js";

interface CredentialsFetchOptions {
  side?: string;
}

interface CredentialsMergeMissingOptions {
  side?: string;
}

interface CredentialsCompareOptions {
  format?: string;
  strict?: boolean;
}

interface CredentialsValidateOptions {
  output?: string;
  strict?: boolean;
  side?: string;
}

interface CredentialDependency {
  dev_id: string;
  name: string;
  type: string | null;
}

interface FillLookupCandidate {
  result_id: string;
  request_id: string;
  name: string;
  type: string | null;
}

interface CompareFieldDifference {
  field: string;
  source: unknown;
  target: unknown;
}

interface CompareItem {
  dev_id: string;
  name: string;
  type: string | null;
  status:
    | "identical"
    | "different"
    | "missing_in_source"
    | "missing_in_target"
    | "type_mismatch";
  differing_fields: CompareFieldDifference[];
}

interface ValidateItem {
  dev_id: string;
  name: string;
  type: string | null;
  missing_required_fields: string[];
}

interface ValidationResult {
  project: string;
  side: string;
  file: string;
  generated_at?: string;
  updated_at?: string;
  totals: {
    credentials: number;
    ready: number;
    missing_required_fields: number;
  };
  credentials: ValidateItem[];
}

type MergeSide = "source" | "target" | "both";
type ValidateSide = "source" | "target" | "manifest" | "all";

export function registerNCredentialsCommand(program: Command): void {
  const credentials = new Command("credentials");
  credentials.description("Credential snapshot and manifest commands");

  credentials
    .command("fetch")
    .argument("<project>", "Project directory")
    .option("--side <source|target|both>", "Choose which snapshot files to generate", "both")
    .description("Fetch source/target credential snapshots for the project dependency graph")
    .action(async (project: string, options: CredentialsFetchOptions) => {
      const env = loadEnv();
      const side = parseMergeSide(options.side);
      const projectMetadata = await readProjectMetadata(project);
      const rootWorkflowId = projectMetadata.plan.root_workflow_id_dev;
      if (!rootWorkflowId) {
        throw new ValidationError(
          `Project "${project}" has no root workflow configured. Run: ndeploy init <workflow_id_dev> [project_root]`,
        );
      }

      const devClient = new N8nClient(env.N8N_DEV_URL, env.N8N_DEV_API_KEY);
      const prodClient = new N8nClient(env.N8N_PROD_URL, env.N8N_PROD_API_KEY);
      const discovery = await discoverCredentialDependencies(devClient, rootWorkflowId);
      const now = new Date().toISOString();

      if (side === "source" || side === "both") {
        const sourceSnapshot = await buildSnapshotFile({
          project,
          side: "source",
          env,
          devClient,
          prodClient,
          dependencies: discovery.dependencies,
          rootWorkflowId,
          rootWorkflowName: discovery.rootWorkflowName ?? projectMetadata.plan.root_workflow_name,
          generatedAt: now,
        });
        const outputPath = resolveProjectCredentialsSourceFilePath(project);
        await writeJsonFile(outputPath, sourceSnapshot);
        logger.success(`[NCREDENTIALS] Source snapshot written: ${outputPath}`);
      }

      if (side === "target" || side === "both") {
        const targetSnapshot = await buildSnapshotFile({
          project,
          side: "target",
          env,
          devClient,
          prodClient,
          dependencies: discovery.dependencies,
          rootWorkflowId,
          rootWorkflowName: discovery.rootWorkflowName ?? projectMetadata.plan.root_workflow_name,
          generatedAt: now,
        });
        const outputPath = resolveProjectCredentialsTargetFilePath(project);
        await writeJsonFile(outputPath, targetSnapshot);
        logger.success(`[NCREDENTIALS] Target snapshot written: ${outputPath}`);
      }
    });

  credentials
    .command("merge-missing")
    .argument("<project>", "Project directory")
    .option("--side <source|target|both>", "Choose which snapshots to merge from", "both")
    .description("Add only missing credentials to credentials_manifest.json from fetched snapshots")
    .action(async (project: string, options: CredentialsMergeMissingOptions) => {
      const projectMetadata = await readProjectMetadata(project);
      const mergeSide = parseMergeSide(options.side);
      const manifestPath = resolveProjectCredentialsManifestFilePath(project);
      const existingManifest = await readManifestFileIfExists(manifestPath);
      const sourceSnapshot = mergeSide === "target" ? null : await readSnapshotForSide(project, "source");
      const targetSnapshot = mergeSide === "source" ? null : await readSnapshotForSide(project, "target");
      const now = new Date().toISOString();

      const manifestByDevId = new Map<string, CredentialsManifestEntry>();
      for (const credential of existingManifest?.credentials ?? []) {
        manifestByDevId.set(credential.dev_id, credential);
      }

      const snapshotEntries = buildSnapshotMergeOrder(mergeSide, sourceSnapshot, targetSnapshot);
      let added = 0;
      let skippedExisting = 0;
      let seededFromSource = 0;
      let seededFromTarget = 0;

      for (const snapshot of snapshotEntries) {
        if (manifestByDevId.has(snapshot.dev_id)) {
          skippedExisting += 1;
          continue;
        }

        const seededFrom = resolveSeededFrom(mergeSide, snapshot);
        manifestByDevId.set(snapshot.dev_id, {
          dev_id: snapshot.dev_id,
          name: snapshot.name,
          type: snapshot.type,
          created_at: now,
          updated_at: now,
          seeded_from: seededFrom,
          template: cloneTemplate(snapshot.template),
        });
        added += 1;
        if (seededFrom === "target") {
          seededFromTarget += 1;
        } else {
          seededFromSource += 1;
        }
      }

      const manifest: CredentialsManifestFile = {
        metadata: {
          schema_version: 1,
          project,
          root_workflow_id_dev: projectMetadata.plan.root_workflow_id_dev ?? "",
          root_workflow_name: projectMetadata.plan.root_workflow_name,
          updated_at: now,
        },
        credentials: [...manifestByDevId.values()].sort((a, b) => a.name.localeCompare(b.name)),
      };
      await writeJsonFile(manifestPath, manifest);
      logger.success(`[NCREDENTIALS] Manifest written: ${manifestPath}`);
      logger.success(
        `[NCREDENTIALS] added=${added} skipped_existing=${skippedExisting} seeded_from_source=${seededFromSource} seeded_from_target=${seededFromTarget}`,
      );
    });

  credentials
    .command("compare")
    .argument("<project>", "Project directory")
    .option("--format <json|table>", "Choose output format", "json")
    .option("--strict", "Exit with error if differences are found")
    .description("Compare credentials_source.json and credentials_target.json")
    .action(async (project: string, options: CredentialsCompareOptions) => {
      await ensureProjectExists(project);
      const sourceFile = await readSnapshotForSide(project, "source");
      const targetFile = await readSnapshotForSide(project, "target");
      const sourceByDevId = new Map(sourceFile.credentials.map((item) => [item.dev_id, item]));
      const targetByDevId = new Map(targetFile.credentials.map((item) => [item.dev_id, item]));
      const allDevIds = [...new Set([...sourceByDevId.keys(), ...targetByDevId.keys()])].sort();

      const items: CompareItem[] = allDevIds.map((devId) => {
        const source = sourceByDevId.get(devId) ?? null;
        const target = targetByDevId.get(devId) ?? null;
        return buildCompareItem(devId, source, target);
      });

      const summary = {
        total: items.length,
        identical: items.filter((item) => item.status === "identical").length,
        different: items.filter((item) => item.status === "different").length,
        missing_in_source: items.filter((item) => item.status === "missing_in_source").length,
        missing_in_target: items.filter((item) => item.status === "missing_in_target").length,
        type_mismatch: items.filter((item) => item.status === "type_mismatch").length,
      };

      if (options.format === "table") {
        for (const item of items) {
          const extra =
            item.differing_fields.length > 0
              ? ` fields=${item.differing_fields.map((field) => field.field).join(",")}`
              : "";
          console.log(`${item.status}\t${item.dev_id}\t${item.name}${extra}`);
        }
      } else {
        console.log(JSON.stringify({ project, summary, credentials: items }, null, 2));
      }

      if (options.strict && summary.identical !== summary.total) {
        throw new ValidationError("Credential comparison found differences between source and target.");
      }
    });

  credentials
    .command("validate")
    .argument("<project>", "Project directory")
    .option("--side <source|target|manifest|all>", "Choose which credential artifact to validate", "manifest")
    .option("-o, --output <file_path>", "Write JSON report to file")
    .option("--strict", "Exit with error if missing required fields are found")
    .description("Validate source/target snapshots or the editable credentials manifest")
    .action(async (project: string, options: CredentialsValidateOptions) => {
      await ensureProjectExists(project);
      const side = parseValidateSide(options.side);
      const outputs: Record<string, unknown> = {};
      let missingRequiredTotal = 0;

      if (side === "source" || side === "all") {
        const snapshot = await readSnapshotForSide(project, "source");
        const result = buildSnapshotValidationResult(project, snapshot);
        outputs.source = result;
        missingRequiredTotal += result.totals.missing_required_fields;
      }

      if (side === "target" || side === "all") {
        const snapshot = await readSnapshotForSide(project, "target");
        const result = buildSnapshotValidationResult(project, snapshot);
        outputs.target = result;
        missingRequiredTotal += result.totals.missing_required_fields;
      }

      if (side === "manifest" || side === "all") {
        const manifest = await readManifestFile(project);
        const result = buildManifestValidationResult(project, manifest);
        outputs.manifest = result;
        missingRequiredTotal += result.totals.missing_required_fields;
      }

      const payload =
        side === "all"
          ? { project, validations: outputs }
          : outputs[side];

      if (options.output) {
        const outputPath = path.resolve(process.cwd(), options.output);
        await writeJsonFile(outputPath, payload);
        logger.success(`[NCREDENTIALS] Validation report written to ${outputPath}`);
      }

      console.log(JSON.stringify(payload, null, 2));

      if (missingRequiredTotal > 0) {
        logger.warn(`[NCREDENTIALS] Missing required fields detected: ${missingRequiredTotal}`);
        if (options.strict) {
          throw new ValidationError(
            `Credential validation failed: ${missingRequiredTotal} required field(s) missing.`,
          );
        }
      } else {
        logger.success("[NCREDENTIALS] Validation passed without missing required fields");
      }
    });

  program.addCommand(credentials);
  logger.debug("Command credentials registered");
}

async function ensureProjectExists(project: string): Promise<void> {
  const projectPath = resolveProjectDir(project);
  const projectExists = await fileExists(projectPath);
  if (!projectExists) {
    throw new ValidationError(
      `Project "${project}" does not exist at ${projectPath}. Run: ndeploy init <workflow_id_dev> [project_root]`,
    );
  }
}

async function readProjectMetadata(project: string): Promise<ProjectMetadata> {
  await ensureProjectExists(project);
  const metadataPath = resolveProjectMetadataFilePath(project);
  const metadataExists = await fileExists(metadataPath);
  if (!metadataExists) {
    throw new ValidationError(
      `Project "${project}" is not initialized. Missing ${metadataPath}. Run: ndeploy init <workflow_id_dev> [project_root]`,
    );
  }
  return readJsonFile<ProjectMetadata>(metadataPath);
}

async function discoverCredentialDependencies(
  devClient: N8nClient,
  rootWorkflowId: string,
): Promise<{ rootWorkflowName: string | null; dependencies: CredentialDependency[] }> {
  const visitedWorkflowIds = new Set<string>();
  const credentialByDevId = new Map<string, CredentialDependency>();
  let rootWorkflowName: string | null = null;

  async function discover(workflowId: string): Promise<void> {
    if (visitedWorkflowIds.has(workflowId)) {
      return;
    }
    visitedWorkflowIds.add(workflowId);

    const workflow = await devClient.getWorkflowById(workflowId);
    if (workflowId === rootWorkflowId) {
      rootWorkflowName = workflow.name;
    }

    for (const node of workflow.nodes) {
      if (node.credentials) {
        for (const credential of Object.values(node.credentials)) {
          const credentialId = extractReferenceId(credential?.id);
          if (!credentialId || credentialByDevId.has(credentialId)) {
            continue;
          }
          const fullCredential = await devClient.getCredentialById(credentialId);
          credentialByDevId.set(credentialId, {
            dev_id: fullCredential.id,
            name: fullCredential.name,
            type: fullCredential.type,
          });
        }
      }

      if (node.type === "n8n-nodes-base.executeWorkflow") {
        const subWorkflowId = extractReferenceId(node.parameters?.workflowId);
        if (subWorkflowId) {
          await discover(subWorkflowId);
        }
      }
    }
  }

  await discover(rootWorkflowId);
  return {
    rootWorkflowName,
    dependencies: [...credentialByDevId.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function buildSnapshotFile(input: {
  project: string;
  side: CredentialSnapshotSide;
  env: AppEnv;
  devClient: N8nClient;
  prodClient: N8nClient;
  dependencies: CredentialDependency[];
  rootWorkflowId: string;
  rootWorkflowName: string | null;
  generatedAt: string;
}): Promise<CredentialSnapshotFile> {
  const entries =
    input.side === "source"
      ? await buildSourceSnapshotEntries(input.devClient, input.env, input.dependencies)
      : await buildTargetSnapshotEntries(input.devClient, input.prodClient, input.env, input.dependencies);

  return {
    metadata: {
      schema_version: 1,
      project: input.project,
      side: input.side,
      root_workflow_id_dev: input.rootWorkflowId,
      root_workflow_name: input.rootWorkflowName,
      generated_at: input.generatedAt,
    },
    credentials: entries,
  };
}

async function buildSourceSnapshotEntries(
  devClient: N8nClient,
  env: AppEnv,
  dependencies: CredentialDependency[],
): Promise<CredentialSnapshotEntry[]> {
  const fillDataById = await resolveFillDataViaSide(
    devClient,
    env,
    dependencies.map((credential) => ({
      result_id: credential.dev_id,
      request_id: credential.dev_id,
      name: credential.name,
      type: credential.type,
    })),
    "source",
  );

  const entries: CredentialSnapshotEntry[] = [];
  for (const dependency of dependencies) {
    const template = await buildTemplateWithFill(
      devClient,
      dependency.type,
      fillDataById.get(dependency.dev_id) ?? null,
      "source",
    );
    entries.push({
      dev_id: dependency.dev_id,
      snapshot_id: dependency.dev_id,
      name: dependency.name,
      snapshot_name: dependency.name,
      type: dependency.type,
      snapshot_type: dependency.type,
      matched_by: "id",
      resolution: templateHasAnyFilledValue(template) ? "resolved" : "missing",
      template,
    });
  }
  return entries;
}

async function buildTargetSnapshotEntries(
  devClient: N8nClient,
  prodClient: N8nClient,
  env: AppEnv,
  dependencies: CredentialDependency[],
): Promise<CredentialSnapshotEntry[]> {
  const targetCandidates = await buildTargetFillCandidates(prodClient, dependencies);
  const fillDataById = await resolveFillDataViaSide(prodClient, env, targetCandidates, "target");
  const candidateByDevId = new Map(targetCandidates.map((candidate) => [candidate.result_id, candidate]));
  const entries: CredentialSnapshotEntry[] = [];

  for (const dependency of dependencies) {
    const candidate = candidateByDevId.get(dependency.dev_id) ?? null;
    const template = await buildTemplateWithFill(
      devClient,
      dependency.type,
      fillDataById.get(dependency.dev_id) ?? null,
      "target",
    );
    entries.push({
      dev_id: dependency.dev_id,
      snapshot_id: candidate?.request_id ?? null,
      name: dependency.name,
      snapshot_name: candidate?.name ?? null,
      type: dependency.type,
      snapshot_type: candidate?.type ?? null,
      matched_by: candidate ? "name" : "unmatched",
      resolution: candidate && templateHasAnyFilledValue(template) ? "resolved" : "missing",
      template,
    });
  }

  return entries;
}

async function buildTemplateWithFill(
  devClient: N8nClient,
  credentialType: string | null,
  fillData: Record<string, unknown> | null,
  fillSide: CredentialSnapshotSide,
): Promise<CredentialTemplate> {
  if (!credentialType) {
    return {
      source: "unavailable",
      required_fields: [],
      fields: [],
      data: {},
      note: "Credential type missing.",
    };
  }

  try {
    const template = await devClient.getCredentialTemplate(credentialType);
    const data = buildTemplateData(template.fields, template.requiredFields);
    if (fillData) {
      for (const [key, value] of Object.entries(fillData)) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          data[key] = value;
        }
      }
    }

    return {
      source: "schema",
      required_fields: template.requiredFields,
      fields: template.fields,
      data,
      note: fillData
        ? `Filled with data available from ${fillSide === "source" ? "DEV" : "PROD"} API/export endpoint.`
        : `No fill data available from ${fillSide === "source" ? "DEV" : "PROD"}. Fields were created from schema only.`,
    };
  } catch {
    return {
      source: "unavailable",
      required_fields: [],
      fields: [],
      data: {},
      note: "Could not load credential schema.",
    };
  }
}

async function buildTargetFillCandidates(
  prodClient: N8nClient,
  dependencies: CredentialDependency[],
): Promise<FillLookupCandidate[]> {
  const result: FillLookupCandidate[] = [];

  for (const dependency of dependencies) {
    const found = await prodClient.findCredentialByName(dependency.name);
    if (!found) {
      continue;
    }
    result.push({
      result_id: dependency.dev_id,
      request_id: found.id,
      name: found.name,
      type: found.type,
    });
  }

  return result;
}

async function resolveFillDataViaSide(
  client: N8nClient,
  env: AppEnv,
  candidates: FillLookupCandidate[],
  side: CredentialSnapshotSide,
): Promise<Map<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>();

  for (const candidate of candidates) {
    const apiData = await client.getCredentialDataForFill(candidate.request_id);
    if (apiData) {
      result.set(candidate.result_id, apiData);
    }
  }

  const unresolved = candidates.filter((candidate) => !result.has(candidate.result_id));
  if (unresolved.length === 0) {
    logger.info(`[NCREDENTIALS] side=${side} source=api resolved=${result.size} unresolved=0`);
    return result;
  }

  const endpoint = resolveCredentialExportEndpoint(env, side);
  if (!endpoint.url || !endpoint.token) {
    logger.info(
      `[NCREDENTIALS] side=${side} source=api resolved=${result.size} unresolved=${unresolved.length} endpoint_fallback=disabled`,
    );
    return result;
  }

  const endpointMap = await fetchFillDataFromExportEndpoint(endpoint.url, endpoint.token, unresolved);
  for (const [credentialId, data] of endpointMap.entries()) {
    if (!result.has(credentialId)) {
      result.set(credentialId, data);
    }
  }

  const stillUnresolved = candidates.filter((candidate) => !result.has(candidate.result_id)).length;
  logger.info(
    `[NCREDENTIALS] side=${side} source=api+endpoint resolved=${result.size} unresolved=${stillUnresolved}`,
  );
  return result;
}

function resolveCredentialExportEndpoint(
  env: AppEnv,
  side: CredentialSnapshotSide,
): { url?: string; token?: string } {
  if (side === "source") {
    return {
      url: env.N8N_DEV_CREDENTIAL_EXPORT_URL,
      token: env.N8N_DEV_CREDENTIAL_EXPORT_TOKEN,
    };
  }

  return {
    url: env.N8N_PROD_CREDENTIAL_EXPORT_URL,
    token: env.N8N_PROD_CREDENTIAL_EXPORT_TOKEN,
  };
}

async function fetchFillDataFromExportEndpoint(
  endpointUrl: string,
  endpointToken: string,
  credentials: FillLookupCandidate[],
): Promise<Map<string, Record<string, unknown>>> {
  try {
    const response = await axios.post(
      endpointUrl,
      {
        credentials: credentials.map((credential) => ({
          dev_id: credential.request_id,
          id: credential.request_id,
          name: credential.name,
          type: credential.type,
        })),
      },
      {
        timeout: 20000,
        headers: {
          Authorization: `Bearer ${endpointToken}`,
          "X-NDEPLOY-TOKEN": endpointToken,
          "Content-Type": "application/json",
        },
      },
    );
    const rawMap = parseExportEndpointResponse(response.data);
    const result = new Map<string, Record<string, unknown>>();
    const resultIdByRequestId = new Map(
      credentials.map((credential) => [credential.request_id, credential.result_id] as const),
    );
    for (const [requestId, data] of rawMap.entries()) {
      const resultId = resultIdByRequestId.get(requestId);
      if (resultId) {
        result.set(resultId, data);
      }
    }
    return result;
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : null;
    logger.warn(
      `[NCREDENTIALS] Credential export endpoint unavailable status=${status ?? "unknown"}`,
    );
    return new Map<string, Record<string, unknown>>();
  }
}

function parseExportEndpointResponse(
  payload: unknown,
): Map<string, Record<string, unknown>> {
  const items = extractCredentialItems(payload);
  const result = new Map<string, Record<string, unknown>>();

  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const idValue = record.dev_id ?? record.id;
    if (typeof idValue !== "string" && typeof idValue !== "number") {
      continue;
    }
    const credentialId = String(idValue);
    const data = extractCredentialData(record);
    if (data) {
      result.set(credentialId, data);
    }
  }

  return result;
}

function extractCredentialItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const root = payload as Record<string, unknown>;
  for (const key of ["credentials", "items", "results", "data"]) {
    const value = root[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  const nestedData = root.data;
  if (nestedData && typeof nestedData === "object" && !Array.isArray(nestedData)) {
    const nested = nestedData as Record<string, unknown>;
    for (const key of ["credentials", "items", "results"]) {
      const value = nested[key];
      if (Array.isArray(value)) {
        return value;
      }
    }
  }

  return [];
}

function extractCredentialData(record: Record<string, unknown>): Record<string, unknown> | null {
  for (const candidate of [record.data, record.credential_data, record.values]) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }
  return null;
}

async function readSnapshotForSide(
  project: string,
  side: CredentialSnapshotSide,
): Promise<CredentialSnapshotFile> {
  const filePath =
    side === "source"
      ? resolveProjectCredentialsSourceFilePath(project)
      : resolveProjectCredentialsTargetFilePath(project);
  const exists = await fileExists(filePath);
  if (!exists) {
    throw new ValidationError(
      `Missing ${filePath}. Run: ndeploy credentials fetch ${project} --side ${side}`,
    );
  }
  const file = await readJsonFile<Partial<CredentialSnapshotFile>>(filePath);
  if (!file.metadata || !Array.isArray(file.credentials)) {
    throw new ValidationError(`Invalid credentials snapshot format in ${filePath}.`);
  }
  return file as CredentialSnapshotFile;
}

async function readManifestFile(project: string): Promise<CredentialsManifestFile> {
  const manifestPath = resolveProjectCredentialsManifestFilePath(project);
  const exists = await fileExists(manifestPath);
  if (!exists) {
    throw new ValidationError(
      `Missing ${manifestPath}. Run: ndeploy credentials merge-missing ${project}`,
    );
  }
  const file = await readJsonFile<Partial<CredentialsManifestFile>>(manifestPath);
  if (!file.metadata || !Array.isArray(file.credentials)) {
    throw new ValidationError(`Invalid credentials manifest format in ${manifestPath}.`);
  }
  return file as CredentialsManifestFile;
}

async function readManifestFileIfExists(
  manifestPath: string,
): Promise<CredentialsManifestFile | null> {
  const exists = await fileExists(manifestPath);
  if (!exists) {
    return null;
  }
  const file = await readJsonFile<Partial<CredentialsManifestFile>>(manifestPath);
  if (!file.metadata || !Array.isArray(file.credentials)) {
    throw new ValidationError(`Invalid credentials manifest format in ${manifestPath}.`);
  }
  return file as CredentialsManifestFile;
}

function buildSnapshotMergeOrder(
  mergeSide: MergeSide,
  sourceSnapshot: CredentialSnapshotFile | null,
  targetSnapshot: CredentialSnapshotFile | null,
): CredentialSnapshotEntry[] {
  if (mergeSide === "source") {
    return [...(sourceSnapshot?.credentials ?? [])];
  }
  if (mergeSide === "target") {
    return [...(targetSnapshot?.credentials ?? [])];
  }

  const sourceByDevId = new Map((sourceSnapshot?.credentials ?? []).map((item) => [item.dev_id, item]));
  const targetByDevId = new Map((targetSnapshot?.credentials ?? []).map((item) => [item.dev_id, item]));
  const orderedDevIds = [
    ...new Set([...(targetSnapshot?.credentials ?? []).map((item) => item.dev_id), ...(sourceSnapshot?.credentials ?? []).map((item) => item.dev_id)]),
  ];

  return orderedDevIds.map((devId) => targetByDevId.get(devId) ?? sourceByDevId.get(devId)).filter(Boolean) as CredentialSnapshotEntry[];
}

function resolveSeededFrom(mergeSide: MergeSide, snapshot: CredentialSnapshotEntry): CredentialManifestSeed {
  if (mergeSide === "source") {
    return "source";
  }
  if (mergeSide === "target") {
    return "target";
  }
  return snapshot.matched_by === "name" ? "target" : "source";
}

function cloneTemplate(template: CredentialTemplate): CredentialTemplate {
  return {
    ...template,
    fields: [...template.fields],
    required_fields: [...template.required_fields],
    data: { ...template.data },
  };
}

function buildCompareItem(
  devId: string,
  source: CredentialSnapshotEntry | null,
  target: CredentialSnapshotEntry | null,
): CompareItem {
  const name = source?.name ?? target?.name ?? devId;
  const type = source?.type ?? target?.type ?? null;

  if (!source) {
    return { dev_id: devId, name, type, status: "missing_in_source", differing_fields: [] };
  }
  if (!target || target.matched_by === "unmatched") {
    return { dev_id: devId, name, type, status: "missing_in_target", differing_fields: [] };
  }
  if (source.type && target.snapshot_type && source.type !== target.snapshot_type) {
    return { dev_id: devId, name, type, status: "type_mismatch", differing_fields: [] };
  }

  const differingFields = computeDifferingFields(source.template.data, target.template.data);
  return {
    dev_id: devId,
    name,
    type,
    status: differingFields.length === 0 ? "identical" : "different",
    differing_fields: differingFields,
  };
}

function computeDifferingFields(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
): CompareFieldDifference[] {
  const keys = [...new Set([...Object.keys(source), ...Object.keys(target)])].sort();
  const diffs: CompareFieldDifference[] = [];
  for (const key of keys) {
    if (JSON.stringify(source[key]) === JSON.stringify(target[key])) {
      continue;
    }
    diffs.push({
      field: key,
      source: source[key] ?? null,
      target: target[key] ?? null,
    });
  }
  return diffs;
}

function buildSnapshotValidationResult(project: string, snapshot: CredentialSnapshotFile): ValidationResult {
  const items: ValidateItem[] = snapshot.credentials.map((credential) => ({
    dev_id: credential.dev_id,
    name: credential.name,
    type: credential.type,
    missing_required_fields: getMissingRequiredFields(credential.template),
  }));
  const missingRequiredTotal = items.reduce(
    (total, item) => total + item.missing_required_fields.length,
    0,
  );

  return {
    project,
    side: snapshot.metadata.side,
    file: snapshot.metadata.side === "source"
      ? resolveProjectCredentialsSourceFilePath(project)
      : resolveProjectCredentialsTargetFilePath(project),
    generated_at: snapshot.metadata.generated_at,
    totals: {
      credentials: items.length,
      ready: items.filter((item) => item.missing_required_fields.length === 0).length,
      missing_required_fields: missingRequiredTotal,
    },
    credentials: items,
  };
}

function buildManifestValidationResult(project: string, manifest: CredentialsManifestFile): ValidationResult {
  const items: ValidateItem[] = manifest.credentials.map((credential) => ({
    dev_id: credential.dev_id,
    name: credential.name,
    type: credential.type,
    missing_required_fields: getMissingRequiredFields(credential.template),
  }));
  const missingRequiredTotal = items.reduce(
    (total, item) => total + item.missing_required_fields.length,
    0,
  );

  return {
    project,
    side: "manifest",
    file: resolveProjectCredentialsManifestFilePath(project),
    updated_at: manifest.metadata.updated_at,
    totals: {
      credentials: items.length,
      ready: items.filter((item) => item.missing_required_fields.length === 0).length,
      missing_required_fields: missingRequiredTotal,
    },
    credentials: items,
  };
}

function getMissingRequiredFields(template: CredentialTemplate): string[] {
  const required = template.required_fields ?? [];
  const data = template.data ?? {};
  return required.filter((fieldName) => isMissingValue(data[fieldName]));
}

function buildTemplateData(
  fields: Array<{ name: string }>,
  requiredFields: string[],
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    data[field.name] = null;
  }
  for (const requiredField of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(data, requiredField)) {
      data[requiredField] = null;
    }
  }
  return data;
}

function templateHasAnyFilledValue(template: CredentialTemplate): boolean {
  return Object.values(template.data ?? {}).some((value) => !isMissingValue(value));
}

function extractReferenceId(reference: unknown): string | null {
  if (typeof reference === "string" || typeof reference === "number") {
    return String(reference);
  }
  if (!reference || typeof reference !== "object") {
    return null;
  }
  const record = reference as Record<string, unknown>;
  const directValue = record.value;
  if (typeof directValue === "string" || typeof directValue === "number") {
    return String(directValue);
  }
  const directId = record.id;
  if (typeof directId === "string" || typeof directId === "number") {
    return String(directId);
  }
  return null;
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

function parseMergeSide(value: string | undefined): MergeSide {
  if (!value || value === "both") {
    return "both";
  }
  if (value === "source" || value === "target") {
    return value;
  }
  throw new ValidationError("Option --side must be one of: source, target, both");
}

function parseValidateSide(value: string | undefined): ValidateSide {
  if (!value || value === "manifest") {
    return "manifest";
  }
  if (value === "source" || value === "target" || value === "manifest" || value === "all") {
    return value;
  }
  throw new ValidationError("Option --side must be one of: source, target, manifest, all");
}
