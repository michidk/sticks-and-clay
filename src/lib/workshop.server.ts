import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { runs, models } from "../db/schema";
import { workshopSchema, type WorkshopSnapshot } from "./workshop";
export async function snapshotWorkshop(
  projectId: string,
  value: unknown,
): Promise<WorkshopSnapshot> {
  const workshop = workshopSchema.parse(value || {});
  const examples = workshop.exampleRunIds.length
    ? await db
        .select()
        .from(runs)
        .where(
          and(
            eq(runs.projectId, projectId),
            inArray(runs.role, ["builder", "graphic", "svg"]),
            eq(runs.status, "done"),
            inArray(runs.id, workshop.exampleRunIds),
          ),
        )
    : [];
  if (examples.length !== workshop.exampleRunIds.length)
    throw new Error("Choose completed examples from this project");
  const assets = examples.length
    ? await db
        .select({ id: models.id, name: models.name })
        .from(models)
        .where(eq(models.projectId, projectId))
    : [];
  return {
    ...workshop,
    examples: examples.map((run) => {
      if ((run.role === "graphic" || run.role === "svg")) {
        const key = (run.result as any)?.key;
        if (!key) throw new Error("Graphic example is unavailable");
        return {
          runId: run.id,
          name:
            assets.find((asset) => asset.id === run.modelId)?.name || run.id,
          renders: [key],
          textures: [],
          metrics: {},
        };
      }
      const artifacts = (run.result as any)?.artifacts;
      if (!artifacts?.blend || artifacts.stage === "geometry")
        throw new Error(
          "Choose a finished material version as a style example",
        );
      return {
        runId: run.id,
        name: assets.find((asset) => asset.id === run.modelId)?.name || run.id,
        script: artifacts.script,
        blend: artifacts.blend,
        renders: artifacts.renders || [],
        textures:
          artifacts.textures
            ?.filter((t: any) => t.kind === "Source / generated")
            .map((t: any) => t.key) || [],
        metrics: artifacts.metrics || {},
      };
    }),
  };
}
