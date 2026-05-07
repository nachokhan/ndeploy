export type CredentialTemplateSource = "schema" | "unavailable";
export type CredentialSnapshotSide = "source" | "target";
export type CredentialSnapshotMatch = "id" | "name" | "unmatched";
export type CredentialSnapshotResolution = "resolved" | "missing";
export type CredentialManifestSeed = "source" | "target" | "both" | "manual";

export interface CredentialTemplateField {
  name: string;
  type: string | null;
  required: boolean;
}

export interface CredentialTemplate {
  source: CredentialTemplateSource;
  required_fields: string[];
  fields: CredentialTemplateField[];
  data: Record<string, unknown>;
  note: string | null;
}

export interface CredentialSnapshotEntry {
  source_id: string;
  snapshot_id: string | null;
  name: string;
  snapshot_name: string | null;
  type: string | null;
  snapshot_type: string | null;
  matched_by: CredentialSnapshotMatch;
  resolution: CredentialSnapshotResolution;
  template: CredentialTemplate;
}

export interface CredentialSnapshotMetadata {
  schema_version: number;
  project: string;
  side: CredentialSnapshotSide;
  root_workflow_id_source: string;
  root_workflow_name: string | null;
  generated_at: string;
}

export interface CredentialSnapshotFile {
  metadata: CredentialSnapshotMetadata;
  credentials: CredentialSnapshotEntry[];
}

export interface CredentialsManifestEntry {
  source_id: string;
  name: string;
  type: string | null;
  created_at: string;
  updated_at: string;
  seeded_from: CredentialManifestSeed;
  template: CredentialTemplate;
}

export interface CredentialsManifestMetadata {
  schema_version: number;
  project: string;
  root_workflow_id_source: string;
  root_workflow_name: string | null;
  updated_at: string;
}

export interface CredentialsManifestFile {
  metadata: CredentialsManifestMetadata;
  credentials: CredentialsManifestEntry[];
}
