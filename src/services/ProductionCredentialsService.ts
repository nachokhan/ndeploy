import {
  CredentialTemplateInfo,
  N8nClient,
} from "./N8nClient.js";
import { DeploymentPlan, PlanActionItem } from "../types/plan.js";
import {
  ProductionCredentialItem,
  ProductionCredentialsFile,
} from "../types/productionCredentials.js";

export class ProductionCredentialsService {
  async build(
    plan: DeploymentPlan,
    devClient: N8nClient,
    prodClient: N8nClient,
  ): Promise<ProductionCredentialsFile> {
    const actionByDevId = new Map<string, PlanActionItem>();
    for (const action of plan.actions) {
      actionByDevId.set(action.dev_id, action);
    }

    const rootWorkflow = actionByDevId.get(plan.metadata.root_workflow_id);
    const credentialActions = plan.actions
      .filter((action) => action.type === "CREDENTIAL")
      .sort((a, b) => a.name.localeCompare(b.name));

    const credentials: ProductionCredentialItem[] = [];
    for (const action of credentialActions) {
      const payload = action.payload as { type?: string } | undefined;
      const credentialType = payload?.type ?? null;
      const existsInProd = action.action === "MAP_EXISTING";
      const template = await this.resolveTemplate(credentialType, devClient, prodClient);

      credentials.push({
        name: action.name,
        type: credentialType,
        dev_id: action.dev_id,
        prod_id: action.prod_id,
        status: existsInProd ? "EXISTS_IN_PROD" : "MISSING_IN_PROD",
        required_action: existsInProd ? "KEEP" : "CREATE",
        template,
      });
    }

    const existsInProdCount = credentials.filter((item) => item.status === "EXISTS_IN_PROD").length;

    return {
      metadata: {
        generated_at: plan.metadata.generated_at,
        plan_id: plan.metadata.plan_id,
        root_workflow_id: plan.metadata.root_workflow_id,
        root_workflow_name: rootWorkflow?.name ?? null,
        source_instance: plan.metadata.source_instance,
        target_instance: plan.metadata.target_instance,
      },
      summary: {
        total: credentials.length,
        exists_in_prod: existsInProdCount,
        missing_in_prod: credentials.length - existsInProdCount,
      },
      credentials,
    };
  }

  private async resolveTemplate(
    credentialType: string | null,
    devClient: N8nClient,
    prodClient: N8nClient,
  ): Promise<ProductionCredentialItem["template"]> {
    if (!credentialType) {
      return {
        source: "unavailable",
        required_fields: [],
        fields: [],
        data: {},
        note: "Credential type missing in plan payload.",
      };
    }

    try {
      const template = await prodClient.getCredentialTemplate(credentialType);
      return {
        source: "prod_schema",
        required_fields: template.requiredFields,
        fields: template.fields,
        data: this.buildEditableData(template),
        note: null,
      };
    } catch {
      // Fallback to DEV schema when PROD cannot provide schema metadata.
    }

    try {
      const template = await devClient.getCredentialTemplate(credentialType);
      return {
        source: "dev_schema",
        required_fields: template.requiredFields,
        fields: template.fields,
        data: this.buildEditableData(template),
        note: "Template came from DEV schema because PROD schema was unavailable.",
      };
    } catch {
      return {
        source: "unavailable",
        required_fields: [],
        fields: [],
        data: {},
        note: "Could not load credential schema from PROD or DEV.",
      };
    }
  }

  private buildEditableData(template: CredentialTemplateInfo): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const field of template.fields) {
      result[field.name] = null;
    }
    for (const fieldName of template.requiredFields) {
      if (!Object.prototype.hasOwnProperty.call(result, fieldName)) {
        result[fieldName] = null;
      }
    }
    return result;
  }
}
