import { randomUUID } from "crypto";
import { DependencyError } from "../errors/index.js";
import { N8nClient } from "./N8nClient.js";
import { sha256 } from "../utils/hash.js";
import { DeploymentPlan, PlanActionItem } from "../types/plan.js";
import { DependencySnapshot, N8nWorkflow } from "../types/n8n.js";

interface WorkflowDetail {
  workflow: N8nWorkflow;
  dependencies: DependencySnapshot;
}

export class PlanService {
  constructor(
    private readonly devClient: N8nClient,
    private readonly prodClient: N8nClient,
    private readonly sourceUrl: string,
    private readonly targetUrl: string,
  ) {}

  async buildPlan(rootWorkflowId: string): Promise<DeploymentPlan> {
    const visitedWorkflowIds = new Set<string>();
    const workflowMap = new Map<string, WorkflowDetail>();
    const credentialIds = new Set<string>();
    const dataTableIds = new Set<string>();

    await this.discoverWorkflowRecursive(
      rootWorkflowId,
      visitedWorkflowIds,
      workflowMap,
      credentialIds,
      dataTableIds,
    );

    const actions: PlanActionItem[] = [];
    for (const credentialId of credentialIds) {
      const credential = await this.devClient.getCredentialById(credentialId);
      const existing = await this.prodClient.findCredentialByName(credential.name);
      actions.push({
        order: 0,
        type: "CREDENTIAL",
        action: existing ? "MAP_EXISTING" : "CREATE",
        dev_id: credential.id,
        prod_id: existing?.id ?? null,
        name: credential.name,
        warning: null,
        payload: {
          name: credential.name,
          type: credential.type,
        },
        dependencies: [],
      });
    }

    for (const dataTableId of dataTableIds) {
      const table = await this.devClient.getDataTableById(dataTableId);
      const rows = await this.devClient.getDataTableRows(dataTableId);
      const existing = await this.prodClient.findDataTableByName(table.name);
      let warning: string | null = null;
      if (existing) {
        const sameSchema = sha256(table.columns) === sha256(existing.columns);
        if (!sameSchema) {
          warning = "Schema differs from PROD table with same name.";
        }
      }

      actions.push({
        order: 0,
        type: "DATATABLE",
        action: existing ? "MAP_EXISTING" : "CREATE",
        dev_id: table.id,
        prod_id: existing?.id ?? null,
        name: table.name,
        warning,
        payload: {
          name: table.name,
          columns: table.columns,
          rows,
        },
        dependencies: [],
      });
    }

    const workflowIds = [...workflowMap.keys()];
    for (const workflowId of workflowIds) {
      const detail = workflowMap.get(workflowId);
      if (!detail) {
        throw new DependencyError("Workflow detail not found after discovery", { workflowId });
      }

      const existing = await this.prodClient.findWorkflowByName(detail.workflow.name);
      const dependencyList = [
        ...detail.dependencies.credentialIds,
        ...detail.dependencies.dataTableIds,
        ...detail.dependencies.subWorkflowIds,
      ];

      actions.push({
        order: 0,
        type: "WORKFLOW",
        action: existing ? "UPDATE" : "CREATE",
        dev_id: detail.workflow.id,
        prod_id: existing?.id ?? null,
        name: detail.workflow.name,
        warning: null,
        payload: {
          checksum: sha256(detail.workflow),
          raw_json: detail.workflow,
        },
        dependencies: dependencyList,
      });
    }

    // Order leaves -> root via dependency depth and root at the end.
    actions.sort((a, b) => {
      const typeWeight = (type: PlanActionItem["type"]): number => {
        if (type === "CREDENTIAL") return 1;
        if (type === "DATATABLE") return 2;
        return 3;
      };
      const typeDiff = typeWeight(a.type) - typeWeight(b.type);
      if (typeDiff !== 0) return typeDiff;

      if (a.type === "WORKFLOW" && b.type === "WORKFLOW") {
        if (a.dev_id === rootWorkflowId) return 1;
        if (b.dev_id === rootWorkflowId) return -1;
        const depDiff = a.dependencies.length - b.dependencies.length;
        if (depDiff !== 0) return depDiff;
      }

      return a.name.localeCompare(b.name);
    });

    actions.forEach((action, index) => {
      action.order = index + 1;
    });

    const root = workflowMap.get(rootWorkflowId);
    if (!root) {
      throw new DependencyError("Root workflow not found after recursive discovery", { rootWorkflowId });
    }

    return {
      metadata: {
        plan_id: randomUUID(),
        generated_at: new Date().toISOString(),
        root_workflow_id: rootWorkflowId,
        source_instance: this.sourceUrl,
        target_instance: this.targetUrl,
        checksum_root: sha256(root.workflow),
      },
      actions,
    };
  }

  private async discoverWorkflowRecursive(
    workflowId: string,
    visited: Set<string>,
    workflowMap: Map<string, WorkflowDetail>,
    credentialIds: Set<string>,
    dataTableIds: Set<string>,
  ): Promise<void> {
    if (visited.has(workflowId)) {
      return;
    }

    visited.add(workflowId);
    const workflow = await this.devClient.getWorkflowById(workflowId);

    const dependencies: DependencySnapshot = {
      credentialIds: new Set<string>(),
      dataTableIds: new Set<string>(),
      subWorkflowIds: new Set<string>(),
    };

    for (const node of workflow.nodes) {
      if (node.credentials) {
        for (const credential of Object.values(node.credentials)) {
          if (!credential?.id) {
            continue;
          }
          dependencies.credentialIds.add(credential.id);
          credentialIds.add(credential.id);
        }
      }

      const workflowParam = node.parameters?.workflowId;
      if (node.type === "n8n-nodes-base.executeWorkflow" && typeof workflowParam === "string") {
        dependencies.subWorkflowIds.add(workflowParam);
      }

      const tableParam = node.parameters?.tableId;
      if (node.type === "n8n-nodes-base.dataTable" && typeof tableParam === "string") {
        dependencies.dataTableIds.add(tableParam);
        dataTableIds.add(tableParam);
      }
    }

    workflowMap.set(workflow.id, {
      workflow,
      dependencies,
    });

    for (const subWorkflowId of dependencies.subWorkflowIds) {
      await this.discoverWorkflowRecursive(
        subWorkflowId,
        visited,
        workflowMap,
        credentialIds,
        dataTableIds,
      );
    }
  }
}
