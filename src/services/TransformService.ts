export class TransformService {
  patchWorkflowIds(rawWorkflow: unknown, idMap: Record<string, string>): unknown {
    return this.walk(rawWorkflow, [], idMap);
  }

  private walk(value: unknown, path: Array<string>, idMap: Record<string, string>): unknown {
    if (Array.isArray(value)) {
      return value.map((item, index) => this.walk(item, [...path, String(index)], idMap));
    }

    if (value !== null && typeof value === "object") {
      const source = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};

      for (const [key, child] of Object.entries(source)) {
        const nextPath = [...path, key];

        if (
          key === "id" &&
          nextPath.length >= 3 &&
          nextPath[nextPath.length - 3] === "credentials" &&
          nextPath[nextPath.length - 1] === "id" &&
          typeof child === "string" &&
          idMap[child]
        ) {
          result[key] = idMap[child];
          continue;
        }

        if (
          (key === "workflowId" || key === "tableId") &&
          typeof child === "string" &&
          idMap[child]
        ) {
          result[key] = idMap[child];
          continue;
        }

        result[key] = this.walk(child, nextPath, idMap);
      }

      return result;
    }

    return value;
  }
}
