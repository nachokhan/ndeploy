import os from "node:os";
import path from "node:path";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";
import { ValidationError } from "../errors/index.js";
import { fileExists, readJsonFile, ProjectMetadata } from "./file.js";

loadDotEnv();

const EnvSchema = z.object({
  N8N_SOURCE_URL: z.string().url(),
  N8N_SOURCE_API_KEY: z.string().min(1),
  N8N_TARGET_URL: z.string().url(),
  N8N_TARGET_API_KEY: z.string().min(1),
  N8N_SOURCE_CREDENTIAL_EXPORT_URL: z.string().url().optional(),
  N8N_SOURCE_CREDENTIAL_EXPORT_TOKEN: z.string().min(1).optional(),
  N8N_TARGET_CREDENTIAL_EXPORT_URL: z.string().url().optional(),
  N8N_TARGET_CREDENTIAL_EXPORT_TOKEN: z.string().min(1).optional(),
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
  mode: "profile" | "env";
  profileName: string | null;
  source: N8nEndpointConfig;
  target: N8nEndpointConfig;
}

interface EnvConfig extends z.infer<typeof EnvSchema> {}

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

  const envConfig = loadEnvIfConfigured();
  if (envConfig) {
    return {
      mode: "env",
      profileName: null,
      source: {
        url: envConfig.N8N_SOURCE_URL,
        apiKey: envConfig.N8N_SOURCE_API_KEY,
        credentialExportUrl: envConfig.N8N_SOURCE_CREDENTIAL_EXPORT_URL,
        credentialExportToken: envConfig.N8N_SOURCE_CREDENTIAL_EXPORT_TOKEN,
      },
      target: {
        url: envConfig.N8N_TARGET_URL,
        apiKey: envConfig.N8N_TARGET_API_KEY,
        credentialExportUrl: envConfig.N8N_TARGET_CREDENTIAL_EXPORT_URL,
        credentialExportToken: envConfig.N8N_TARGET_CREDENTIAL_EXPORT_TOKEN,
      },
    };
  }

  const profilesPath = resolveProfilesFilePath();
  const profilesExists = await fileExists(profilesPath);
  throw new ValidationError(
    profilesExists
      ? "No profile selected. Set deploy.profile in project.json or pass --profile <name>."
      : `Missing runtime configuration. Create ${profilesPath} or configure N8N_SOURCE_*/N8N_TARGET_* variables in .env.`,
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
      `Profiles file not found at ${profilesPath}. Create it or configure .env variables.`,
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

function loadEnvIfConfigured(): EnvConfig | null {
  const candidate = {
    N8N_SOURCE_URL: process.env.N8N_SOURCE_URL,
    N8N_SOURCE_API_KEY: process.env.N8N_SOURCE_API_KEY,
    N8N_TARGET_URL: process.env.N8N_TARGET_URL,
    N8N_TARGET_API_KEY: process.env.N8N_TARGET_API_KEY,
    N8N_SOURCE_CREDENTIAL_EXPORT_URL: process.env.N8N_SOURCE_CREDENTIAL_EXPORT_URL,
    N8N_SOURCE_CREDENTIAL_EXPORT_TOKEN: process.env.N8N_SOURCE_CREDENTIAL_EXPORT_TOKEN,
    N8N_TARGET_CREDENTIAL_EXPORT_URL: process.env.N8N_TARGET_CREDENTIAL_EXPORT_URL,
    N8N_TARGET_CREDENTIAL_EXPORT_TOKEN: process.env.N8N_TARGET_CREDENTIAL_EXPORT_TOKEN,
  };

  const hasAnyEnvValue = Object.values(candidate).some((value) => value !== undefined);
  if (!hasAnyEnvValue) {
    return null;
  }

  const parsed = EnvSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ValidationError(
      "Invalid .env configuration",
      parsed.error.flatten(),
    );
  }

  return parsed.data;
}
