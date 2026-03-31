import { DeploymentPlan, PlanActionItem } from "../types/plan.js";
import {
  PlanSummary,
  PlanSummaryCredentialItem,
  PlanSummaryDataTableItem,
  PlanSummaryWorkflowDependencyItem,
  PlanSummaryWorkflowItem,
} from "../types/planSummary.js";

export class PlanSummaryService {
  buildSummary(plan: DeploymentPlan): PlanSummary {
    const actionByDevId = new Map<string, PlanActionItem>();
    for (const action of plan.actions) {
      actionByDevId.set(action.dev_id, action);
    }

    const credentials: PlanSummaryCredentialItem[] = plan.actions
      .filter((action) => action.type === "CREDENTIAL")
      .map((action) => {
        const payload = action.payload as { type?: string } | undefined;
        return {
          name: action.name,
          type: payload?.type ?? null,
          action: action.action,
        };
      });

    const datatables: PlanSummaryDataTableItem[] = plan.actions
      .filter((action) => action.type === "DATATABLE")
      .map((action) => ({
        name: action.name,
        action: action.action,
      }));

    const workflows: PlanSummaryWorkflowItem[] = plan.actions
      .filter((action) => action.type === "WORKFLOW")
      .sort((a, b) => a.order - b.order)
      .map((action) => ({
        order: action.order,
        name: action.name,
        action: action.action,
        dependencies: this.resolveDependencies(action, actionByDevId),
        observability: action.observability ?? null,
      }));

    const rootWorkflow = actionByDevId.get(plan.metadata.root_workflow_id);
    const byAction = {
      CREATE: plan.actions.filter((action) => action.action === "CREATE").length,
      UPDATE: plan.actions.filter((action) => action.action === "UPDATE").length,
      MAP_EXISTING: plan.actions.filter((action) => action.action === "MAP_EXISTING").length,
    };

    return {
      metadata: {
        plan_id: plan.metadata.plan_id,
        generated_at: plan.metadata.generated_at,
        root_workflow_id: plan.metadata.root_workflow_id,
        root_workflow_name: rootWorkflow?.name ?? null,
        source_instance: plan.metadata.source_instance,
        target_instance: plan.metadata.target_instance,
      },
      totals: {
        actions: plan.actions.length,
        credentials: credentials.length,
        datatables: datatables.length,
        workflows: workflows.length,
        by_action: byAction,
      },
      credentials,
      datatables,
      workflows,
    };
  }

  private resolveDependencies(
    workflowAction: PlanActionItem,
    actionByDevId: Map<string, PlanActionItem>,
  ): PlanSummaryWorkflowDependencyItem[] {
    return workflowAction.dependencies.map((dependencyDevId) => {
      const dependencyAction = actionByDevId.get(dependencyDevId);
      if (!dependencyAction) {
        return {
          name: null,
          type: "UNKNOWN",
          action: null,
        };
      }

      return {
        name: dependencyAction.name,
        type: dependencyAction.type,
        action: dependencyAction.action,
      };
    });
  }
}
