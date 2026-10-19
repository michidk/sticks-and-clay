import { z } from "zod";
import { collectionAssetGroups } from "@/lib/project-summary";
import type { BoardVersion, BoardProject } from "@/lib/board-data";

const artifactsSchema = z.object({
  image: z.string().optional(),
  format: z.string().optional(),
  renders: z.array(z.string()).optional(),
  parts: z.array(z.object({ name: z.string(), key: z.string() })).optional(),
});
const previewSchema = z.object({
  key: z.string(),
  previews: z.array(z.object({ key: z.string(), label: z.string() })),
});
const raster = (key: string) => /\.(png|jpe?g|webp)$/i.test(key);

export function finishedAssetReferences(versions: Pick<BoardVersion, "id" | "assetId" | "name" | "status" | "artifacts" | "createdAt">[], runs: BoardProject["runs"]) {
  return collectionAssetGroups(versions).flatMap(({ representative: version }) => {
    if (version.status !== "done") return [];
    const parsed = artifactsSchema.safeParse(version.artifacts);
    if (!parsed.success) return [];
    const artifacts = parsed.data;
    const saved = runs.filter((run) => run.modelId === version.id && run.status === "done")
      .map((run) => previewSchema.safeParse(run.result))
      .find((result) => result.success && result.data.key === artifacts.image);
    const images = artifacts.image?.endsWith(".svg")
      ? [{ key: artifacts.image.replace(/[^/]+$/, "preview.png"), label: "Image" }]
      : artifacts.renders?.length
      ? artifacts.renders.map((key, index) => ({ key, label: `Photo ${index + 1}` }))
      : artifacts.parts?.length
        ? artifacts.parts.map(({ key, name }) => ({ key, label: name }))
        : artifacts.image && raster(artifacts.image) && artifacts.format !== "cad"
          ? [{ key: artifacts.image, label: "Image" }]
          : saved?.success ? saved.data.previews : [];
    return images.filter(({ key }) => raster(key)).map((image) => ({
      ...image, name: version.name.replaceAll("_", " "), versionId: version.id,
    }));
  });
}
