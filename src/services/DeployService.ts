import { DeploymentPlan, DeploymentPlanSchema, PlanActionItem } from "../types/plan.js";
import { N8nClient } from "./N8nClient.js";
import { TransformService } from "./TransformService.js";
import { ValidationError } from "../errors/index.js";
import { sha256 } from "../utils/hash.js";

export class DeployService {
  constructor(
    private readonly devClient: N8nClient,
    private readonly prodClient: N8nClient,
    private readonly transformService: TransformService,
  ) {}

  async validatePlan(plan: unknown): Promise<DeploymentPlan> {
    const parsed = DeploymentPlanSchema.safeParse(plan);
    if (!parsed.success) {
      throw new ValidationError("Invalid deployment plan schema", parsed.error.flatten());
    }

    const root = parsed.data.actions.find(
      (a) => a.type === "WORKFLOW" && a.dev_id === parsed.data.metadata.root_workflow_id,
    );
    if (!root) {
      throw new ValidationError("Root workflow action not found in plan", parsed.data.metadata);
    }

    const currentRoot = await this.devClient.getWorkflowById(parsed.data.metadata.root_workflow_id);
    const currentHash = sha256(currentRoot);
    if (currentHash !== parsed.data.metadata.checksum_root) {
      throw new ValidationError("DEV root workflow has changed since plan generation", {
        expected: parsed.data.metadata.checksum_root,
        actual: currentHash,
      });
    }

    return parsed.data;
  }

  async executePlan(plan: DeploymentPlan): Promise<void> {
    const idMap: Record<string, string> = {};

    for (const action of plan.actions.sort((a, b) => a.order - b.order)) {
      await this.executeAction(action, idMap);
    }
  }

  private async executeAction(action: PlanActionItem, idMap: Record<string, string>): Promise<void> {
    if (action.type === "CREDENTIAL") {
      await this.executeCredential(action, idMap);
      return;
    }

    if (action.type === "DATATABLE") {
      await this.executeDataTable(action, idMap);
      return;
    }

    await this.executeWorkflow(action, idMap);
  }

  private async executeCredential(action: PlanActionItem, idMap: Record<string, string>): Promise<void> {
    if (action.action === "MAP_EXISTING" && action.prod_id) {
      idMap[action.dev_id] = action.prod_id;
      return;
    }

    const payload = action.payload as { name: string; type: string };
    const created = await this.prodClient.createCredentialPlaceholder({
      name: payload.name,
      type: payload.type,
    });
    idMap[action.dev_id] = created.id;
  }

  private async executeDataTable(action: PlanActionItem, idMap: Record<string, string>): Promise<void> {
    if (action.action === "MAP_EXISTING" && action.prod_id) {
      idMap[action.dev_id] = action.prod_id;
      return;
    }

    const payload = action.payload as {
      name: string;
      columns: Array<Record<string, unknown>>;
      rows: Array<Record<string, unknown>>;
    };
    const created = await this.prodClient.createDataTable(payload);
    idMap[action.dev_id] = created.id;
  }

  private async executeWorkflow(action: PlanActionItem, idMap: Record<string, string>): Promise<void> {
    const payload = action.payload as {
      raw_json: unknown;
    };

    const patchedWorkflow = this.transformService.patchWorkflowIds(payload.raw_json, idMap);

    if (action.action === "UPDATE") {
      const targetId = action.prod_id ?? idMap[action.dev_id];
      if (!targetId) {
        throw new ValidationError("Workflow UPDATE action missing prod_id mapping", {
          devId: action.dev_id,
          name: action.name,
        });
      }
      const updated = await this.prodClient.updateWorkflow(targetId, patchedWorkflow);
      idMap[action.dev_id] = updated.id;
      return;
    }

    const created = await this.prodClient.createWorkflow(patchedWorkflow);
    idMap[action.dev_id] = created.id;
  }
}
