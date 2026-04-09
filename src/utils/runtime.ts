import os from "node:os";
import path from "node:path";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";
import { ValidationError } from "../errors/index.js";
import { fileExists, readJsonFile, ProjectMetadata } from "./file.js";

loadDotEnv();

const LegacyEnvSchema = z.object({
  N8N_DEV_URL: z.string().url(),
  N8N_DEV_API_KEY: z.string().min(1),
  N8N_PROD_URL: z.string().url(),
  N8N_PROD_API_KEY: z.string().min(1),
  N8N_DEV_CREDENTIAL_EXPORT_URL: z.string().url().optional(),
  N8N_DEV_CREDENTIAL_EXPORT_TOKEN: z.string().min(1).optional(),
  N8N_PROD_CREDENTIAL_EXPORT_URL: z.string().url().optional(),
  N8N_PROD_CREDENTIAL_EXPORT_TOKEN: z.string().min(1).optional(),
});

const ProfileEndpointSchema = z.object({
  url: z.string().url(),
  api_key: z.string().min(1),
  credential_export_url: z.string().url().optional(),
  credential_export_token: z.string().min(1).optional(),
});

const ProfilesFileSchema = z.object({
  schema_version: z.number().int().positive().optional(),
  profiles: z.record(
    z.string().min(1),
    z.object({
      source: ProfileEndpointSchema,
      target: ProfileEndpointSchema,
    }),
  ),
});

export interface N8nEndpointConfig {
  url: string;
  apiKey: string;
  credentialExportUrl?: string;
  credentialExportToken?: string;
}

export interface RuntimeConfig {
  mode: "profile" | "legacy-env";
  profileName: string | null;
  source: N8nEndpointConfig;
  target: N8nEndpointConfig;
}

interface LegacyEnv extends z.infer<typeof LegacyEnvSchema> {}

interface ProfilesFile extends z.infer<typeof ProfilesFileSchema> {}

export function resolveProfilesFilePath(): string {
  return path.join(os.homedir(), ".ndeploy", "profiles.json");
}

export async function resolveRuntimeConfig(options?: {
  profile?: string;
  projectMetadata?: ProjectMetadata | null;
}): Promise<RuntimeConfig> {
  const requestedProfile = options?.profile?.trim() || null;
  const metadataProfile = options?.projectMetadata?.deploy?.profile?.trim() || null;
  const profileName = requestedProfile ?? metadataProfile;

  if (profileName) {
    return loadRuntimeConfigFromProfile(profileName);
  }

  const legacyEnv = loadLegacyEnvIfConfigured();
  if (legacyEnv) {
    return {
      mode: "legacy-env",
      profileName: null,
      source: {
        url: legacyEnv.N8N_DEV_URL,
        apiKey: legacyEnv.N8N_DEV_API_KEY,
        credentialExportUrl: legacyEnv.N8N_DEV_CREDENTIAL_EXPORT_URL,
        credentialExportToken: legacyEnv.N8N_DEV_CREDENTIAL_EXPORT_TOKEN,
      },
      target: {
        url: legacyEnv.N8N_PROD_URL,
        apiKey: legacyEnv.N8N_PROD_API_KEY,
        credentialExportUrl: legacyEnv.N8N_PROD_CREDENTIAL_EXPORT_URL,
        credentialExportToken: legacyEnv.N8N_PROD_CREDENTIAL_EXPORT_TOKEN,
      },
    };
  }

  const profilesPath = resolveProfilesFilePath();
  const profilesExists = await fileExists(profilesPath);
  throw new ValidationError(
    profilesExists
      ? "No profile selected. Set deploy.profile in project.json or pass --profile <name>."
      : `Missing runtime configuration. Create ${profilesPath} or configure legacy N8N_DEV_*/N8N_PROD_* variables in .env.`,
  );
}

async function loadRuntimeConfigFromProfile(profileName: string): Promise<RuntimeConfig> {
  const profilesPath = resolveProfilesFilePath();
  const profilesFile = await readProfilesFile(profilesPath);
  const profile = profilesFile.profiles[profileName];

  if (!profile) {
    const availableProfiles = Object.keys(profilesFile.profiles).sort();
    throw new ValidationError(
      `Profile "${profileName}" was not found in ${profilesPath}. Available profiles: ${availableProfiles.join(", ") || "(none)"}.`,
    );
  }

  return {
    mode: "profile",
    profileName,
    source: {
      url: profile.source.url,
      apiKey: profile.source.api_key,
      credentialExportUrl: profile.source.credential_export_url,
      credentialExportToken: profile.source.credential_export_token,
    },
    target: {
      url: profile.target.url,
      apiKey: profile.target.api_key,
      credentialExportUrl: profile.target.credential_export_url,
      credentialExportToken: profile.target.credential_export_token,
    },
  };
}

async function readProfilesFile(profilesPath: string): Promise<ProfilesFile> {
  const exists = await fileExists(profilesPath);
  if (!exists) {
    throw new ValidationError(
      `Profiles file not found at ${profilesPath}. Create it or configure legacy .env variables.`,
    );
  }

  const raw = await readJsonFile<unknown>(profilesPath);
  const parsed = ProfilesFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(
      `Invalid profiles file at ${profilesPath}`,
      parsed.error.flatten(),
    );
  }
  return parsed.data;
}

function loadLegacyEnvIfConfigured(): LegacyEnv | null {
  const candidate = {
    N8N_DEV_URL: process.env.N8N_DEV_URL,
    N8N_DEV_API_KEY: process.env.N8N_DEV_API_KEY,
    N8N_PROD_URL: process.env.N8N_PROD_URL,
    N8N_PROD_API_KEY: process.env.N8N_PROD_API_KEY,
    N8N_DEV_CREDENTIAL_EXPORT_URL: process.env.N8N_DEV_CREDENTIAL_EXPORT_URL,
    N8N_DEV_CREDENTIAL_EXPORT_TOKEN: process.env.N8N_DEV_CREDENTIAL_EXPORT_TOKEN,
    N8N_PROD_CREDENTIAL_EXPORT_URL: process.env.N8N_PROD_CREDENTIAL_EXPORT_URL,
    N8N_PROD_CREDENTIAL_EXPORT_TOKEN: process.env.N8N_PROD_CREDENTIAL_EXPORT_TOKEN,
  };

  const hasAnyLegacyValue = Object.values(candidate).some((value) => value !== undefined);
  if (!hasAnyLegacyValue) {
    return null;
  }

  const parsed = LegacyEnvSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ValidationError(
      "Invalid legacy .env configuration",
      parsed.error.flatten(),
    );
  }

  return parsed.data;
}
