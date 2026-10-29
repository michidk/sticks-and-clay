import { checkpoint, jobContext } from "./checkpoint.server";
import { productionPlanResult, productionPlanText, type ProductionPlan } from "./production-plan";
import { runRole, roleInput } from "../modules/ai/index.server";

type ProductionPlanInput = {
  assetType: "model" | "cad" | "graphic" | "svg" | "pixel" | "material";
  projectId: string;
  batchId?: string;
  modelId?: string;
  name: string;
  design: string;
  request: string;
  context?: string;
  evidence?: string[];
};

/** Runs once per durable production attempt and returns the frozen execution plan. */
export async function ensureProductionPlan(input: ProductionPlanInput): Promise<ProductionPlan> {
  const job = jobContext.getStore();
  if (!job) throw new Error("Missing durable job context");
  const saved = job.checkpoint["production-plan"];
  if (saved) return productionPlanResult.parse(JSON.parse(saved));
  const { result, runId } = await runRole({
    role: "production-planner",
    stepId: "production-plan",
    projectId: input.projectId,
    batchId: input.batchId,
    modelId: input.modelId,
    images: input.evidence,
    input: await roleInput("production-planner", {
      assetType: input.assetType,
      design: input.design,
      name: input.name,
      request: input.request,
      context: input.context || "None",
      evidence: input.evidence?.length
        ? input.evidence.map((key, index) => `Image ${index + 1}: ${key}`).join("\n")
        : "None",
    }),
  });
  const plan = productionPlanResult.parse(result);
  await checkpoint("production-plan", JSON.stringify(plan));
  await checkpoint("production-plan-run", runId);
  return plan;
}

export { productionPlanText };
