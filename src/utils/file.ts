import { promises as fs } from "fs";
import path from "path";

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(filePath, content, "utf8");
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export function resolvePlanFileName(rootWorkflowId: string): string {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  return path.resolve(process.cwd(), `plan_${rootWorkflowId}_${stamp}.json`);
}
