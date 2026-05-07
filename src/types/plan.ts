import { z } from "zod";

export const PlanActionTypeSchema = z.enum(["CREDENTIAL", "DATATABLE", "WORKFLOW"]);
export const PlanActionSchema = z.enum(["CREATE", "UPDATE", "MAP_EXISTING"]);
export const WorkflowComparisonAtPlanSchema = z.enum([
  "equal",
  "different",
  "unknown",
  "not_applicable",
]);
export const WorkflowComparisonReasonSchema = z.enum([
  "matched_after_normalization",
  "content_diff_detected",
  "unresolved_future_ids",
  "target_missing",
  "target_read_failed",
  "normalization_failed",
]);

export const WorkflowObservabilitySchema = z.object({
  target_comparison_at_plan: WorkflowComparisonAtPlanSchema,
  comparison_reason: WorkflowComparisonReasonSchema,
});

export const PlanMetadataSchema = z.object({
  plan_id: z.string(),
  generated_at: z.string(),
  root_workflow_id: z.string(),
  source_instance: z.string(),
  target_instance: z.string(),
  checksum_root: z.string(),
});

export const PlanActionItemSchema = z.object({
  order: z.number().int().nonnegative(),
  type: PlanActionTypeSchema,
  action: PlanActionSchema,
  source_id: z.string(),
  target_id: z.string().nullable(),
  name: z.string(),
  warning: z.string().nullable().optional(),
  payload: z.unknown(),
  dependencies: z.array(z.string()).default([]),
  observability: WorkflowObservabilitySchema.optional(),
});

export const DeploymentPlanSchema = z.object({
  metadata: PlanMetadataSchema,
  actions: z.array(PlanActionItemSchema),
});

export type PlanActionType = z.infer<typeof PlanActionTypeSchema>;
export type PlanAction = z.infer<typeof PlanActionSchema>;
export type WorkflowComparisonAtPlan = z.infer<typeof WorkflowComparisonAtPlanSchema>;
export type WorkflowComparisonReason = z.infer<typeof WorkflowComparisonReasonSchema>;
export type WorkflowObservability = z.infer<typeof WorkflowObservabilitySchema>;
export type PlanMetadata = z.infer<typeof PlanMetadataSchema>;
export type PlanActionItem = z.infer<typeof PlanActionItemSchema>;
export type DeploymentPlan = z.infer<typeof DeploymentPlanSchema>;
