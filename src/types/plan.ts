import { z } from "zod";

export const PlanActionTypeSchema = z.enum(["CREDENTIAL", "DATATABLE", "WORKFLOW"]);
export const PlanActionSchema = z.enum(["CREATE", "UPDATE", "MAP_EXISTING"]);

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
  dev_id: z.string(),
  prod_id: z.string().nullable(),
  name: z.string(),
  warning: z.string().nullable().optional(),
  payload: z.unknown(),
  dependencies: z.array(z.string()).default([]),
});

export const DeploymentPlanSchema = z.object({
  metadata: PlanMetadataSchema,
  actions: z.array(PlanActionItemSchema),
});

export type PlanActionType = z.infer<typeof PlanActionTypeSchema>;
export type PlanAction = z.infer<typeof PlanActionSchema>;
export type PlanMetadata = z.infer<typeof PlanMetadataSchema>;
export type PlanActionItem = z.infer<typeof PlanActionItemSchema>;
export type DeploymentPlan = z.infer<typeof DeploymentPlanSchema>;
