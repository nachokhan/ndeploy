import axios, { AxiosError, AxiosInstance } from "axios";
import { ApiError } from "../errors/index.js";
import {
  N8nCredential,
  N8nCredentialSchema,
  N8nDataTable,
  N8nDataTableRowsSchema,
  N8nDataTableSchema,
  N8nWorkflow,
  N8nWorkflowSchema,
} from "../types/n8n.js";
import { z } from "zod";
import { logger } from "../utils/logger.js";

interface ListResponse<T> {
  data?: T[];
}

interface CredentialListItem {
  id: string;
  name: string;
  type?: string;
}

const WorkflowSummarySchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  name: z.string(),
});

const CredentialListItemSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  name: z.string(),
  type: z.string().optional(),
});

const DataTableSummarySchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  name: z.string(),
});

function normalizeAxiosError(error: unknown, context: Record<string, unknown>): ApiError {
  const axiosErr = error as AxiosError;
  const status = axiosErr.response?.status;
  const responseData = axiosErr.response?.data;
  const message = axiosErr.message || "Unknown API error";
  return new ApiError(message, status, { ...context, responseData });
}

export class N8nClient {
  private readonly api: AxiosInstance;
  private credentialCache: CredentialListItem[] | null = null;

  constructor(baseURL: string, apiKey: string) {
    this.api = axios.create({
      baseURL,
      timeout: 15000,
      headers: {
        "X-N8N-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
    });
  }

  async getWorkflowById(id: string): Promise<N8nWorkflow> {
    try {
      const response = await this.api.get(`/api/v1/workflows/${id}`);
      return N8nWorkflowSchema.parse(response.data);
    } catch (error) {
      throw normalizeAxiosError(error, { entity: "workflow", id });
    }
  }

  async findWorkflowByName(name: string): Promise<N8nWorkflow | null> {
    try {
      const response = await this.api.get<ListResponse<unknown>>(`/api/v1/workflows`);
      const list = response.data?.data ?? [];
      const parsed = z.array(WorkflowSummarySchema).parse(list);
      const found = parsed.find((wf) => wf.name === name);
      if (!found) {
        return null;
      }
      return this.getWorkflowById(found.id);
    } catch (error) {
      throw normalizeAxiosError(error, { entity: "workflow", name, op: "findByName" });
    }
  }

  async createWorkflow(payload: unknown): Promise<N8nWorkflow> {
    try {
      const response = await this.api.post(`/api/v1/workflows`, payload);
      return N8nWorkflowSchema.parse(response.data);
    } catch (error) {
      throw normalizeAxiosError(error, { entity: "workflow", op: "create" });
    }
  }

  async updateWorkflow(id: string, payload: unknown): Promise<N8nWorkflow> {
    try {
      const response = await this.api.put(`/api/v1/workflows/${id}`, payload);
      return N8nWorkflowSchema.parse(response.data);
    } catch (error) {
      throw normalizeAxiosError(error, { entity: "workflow", op: "update", id });
    }
  }

  async getCredentialById(id: string): Promise<N8nCredential> {
    try {
      const list = await this.listCredentials();
      const found = list.find((credential) => credential.id === id);
      if (!found) {
        throw new ApiError("Credential not found in credential list", 404, { entity: "credential", id });
      }
      if (!found.type) {
        throw new ApiError("Credential type missing in API list response", 422, {
          entity: "credential",
          id,
          name: found.name,
        });
      }
      return N8nCredentialSchema.parse({
        id: found.id,
        name: found.name,
        type: found.type,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw normalizeAxiosError(error, { entity: "credential", id });
    }
  }

  async findCredentialByName(name: string): Promise<N8nCredential | null> {
    try {
      const list = await this.listCredentials();
      const found = list.find((credential) => credential.name === name);
      if (!found) {
        return null;
      }
      return N8nCredentialSchema.parse({
        id: found.id,
        name: found.name,
        // n8n API returns type in list payload; if missing we still allow mapping by name/id.
        type: found.type ?? "unknown",
      });
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw normalizeAxiosError(error, { entity: "credential", name, op: "findByName" });
    }
  }

  async createCredentialPlaceholder(payload: { name: string; type: string }): Promise<N8nCredential> {
    try {
      const response = await this.api.post(`/api/v1/credentials`, {
        name: payload.name,
        type: payload.type,
      });
      return N8nCredentialSchema.parse(response.data);
    } catch (error) {
      throw normalizeAxiosError(error, { entity: "credential", op: "create" });
    }
  }

  async getDataTableById(id: string): Promise<N8nDataTable> {
    try {
      const response = await this.api.get(`/api/v1/data-tables/${id}`);
      return N8nDataTableSchema.parse(response.data);
    } catch (error) {
      throw normalizeAxiosError(error, { entity: "data-table", id });
    }
  }

  async findDataTableByName(name: string): Promise<N8nDataTable | null> {
    try {
      const response = await this.api.get<ListResponse<unknown>>(`/api/v1/data-tables`);
      const list = response.data?.data ?? [];
      const parsed = z.array(DataTableSummarySchema).parse(list);
      const found = parsed.find((table) => table.name === name);
      return found ? this.getDataTableById(found.id) : null;
    } catch (error) {
      throw normalizeAxiosError(error, { entity: "data-table", name, op: "findByName" });
    }
  }

  async getDataTableRows(id: string): Promise<Array<Record<string, unknown>>> {
    try {
      const response = await this.api.get(`/api/v1/data-tables/${id}/rows`);
      return N8nDataTableRowsSchema.parse(response.data?.data ?? response.data);
    } catch (error) {
      throw normalizeAxiosError(error, { entity: "data-table-rows", id });
    }
  }

  async createDataTable(payload: {
    name: string;
    columns: Array<Record<string, unknown>>;
    rows?: Array<Record<string, unknown>>;
  }): Promise<N8nDataTable> {
    try {
      const response = await this.api.post(`/api/v1/data-tables`, {
        name: payload.name,
        columns: payload.columns,
      });
      const table = N8nDataTableSchema.parse(response.data);
      if (payload.rows && payload.rows.length > 0) {
        await this.api.post(`/api/v1/data-tables/${table.id}/rows/batch`, { rows: payload.rows });
      }
      return table;
    } catch (error) {
      throw normalizeAxiosError(error, { entity: "data-table", op: "create" });
    }
  }

  private async listCredentials(): Promise<CredentialListItem[]> {
    if (this.credentialCache) {
      logger.debug(`[N8N_CLIENT] credentials cache hit count=${this.credentialCache.length}`);
      return this.credentialCache;
    }
    try {
      logger.debug("[N8N_CLIENT] Fetching credentials list from /api/v1/credentials");
      const response = await this.api.get<ListResponse<unknown> | unknown[]>(`/api/v1/credentials`);
      const raw = this.extractList(response.data);
      const parsed = z.array(CredentialListItemSchema).parse(raw);
      this.credentialCache = parsed;
      logger.debug(`[N8N_CLIENT] credentials fetched count=${parsed.length}`);
      return parsed;
    } catch (error) {
      throw normalizeAxiosError(error, { entity: "credential", op: "list" });
    }
  }

  private extractList(payload: unknown): unknown[] {
    if (Array.isArray(payload)) {
      return payload;
    }
    const maybeWrapped = payload as ListResponse<unknown>;
    if (Array.isArray(maybeWrapped?.data)) {
      return maybeWrapped.data;
    }
    return [];
  }
}
