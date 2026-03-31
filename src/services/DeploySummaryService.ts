import { DeployResult, DeploySummary, DeploySummaryActionItem } from "../types/deployResult.js";

export class DeploySummaryService {
  buildSummary(result: DeployResult): DeploySummary {
    return {
      metadata: result.metadata,
      totals: result.totals,
      credentials: result.credentials.map((item) => this.toSummaryAction(item)),
      datatables: result.datatables.map((item) => this.toSummaryAction(item)),
      workflows: result.workflows.map((item) => this.toSummaryAction(item)),
      errors: result.errors,
    };
  }

  private toSummaryAction(item: DeployResult["credentials"][number]): DeploySummaryActionItem {
    return {
      order: item.order,
      name: item.name,
      action: item.action,
      status: item.status,
      publish_status: item.publish_status,
    };
  }
}
