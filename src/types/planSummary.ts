import { PlanAction, PlanActionType, WorkflowObservability } from "./plan.js";

export interface PlanSummaryMetadata {
  plan_id: string;
  generated_at: string;
  root_workflow_id: string;
  root_workflow_name: string | null;
  source_instance: string;
  target_instance: string;
}

export interface PlanSummaryTotals {
  actions: number;
  credentials: number;
  datatables: number;
  workflows: number;
  by_action: {
    CREATE: number;
    UPDATE: number;
    MAP_EXISTING: number;
  };
}

export interface PlanSummaryCredentialItem {
  name: string;
  type: string | null;
  action: PlanAction;
}

export interface PlanSummaryDataTableItem {
  name: string;
  action: PlanAction;
}

export interface PlanSummaryWorkflowDependencyItem {
  name: string | null;
  type: PlanActionType | "UNKNOWN";
  action: PlanAction | null;
}

export interface PlanSummaryWorkflowItem {
  order: number;
  name: string;
  action: PlanAction;
  dependencies: PlanSummaryWorkflowDependencyItem[];
  observability: WorkflowObservability | null;
}

export interface PlanSummary {
  metadata: PlanSummaryMetadata;
  totals: PlanSummaryTotals;
  credentials: PlanSummaryCredentialItem[];
  datatables: PlanSummaryDataTableItem[];
  workflows: PlanSummaryWorkflowItem[];
}
