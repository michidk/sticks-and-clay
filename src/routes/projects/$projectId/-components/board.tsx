import { Board as AssetBoard } from "@/components/board";
import type { BoardProject } from "@/lib/board-data";

export function Board({ projectId, project, ideas, models, batches, runs, assets, onRefresh }: Omit<BoardProject, "project"> & {
  projectId: string;
  project: Omit<BoardProject["project"], "id" | "name"> & { name?: string };
  onRefresh: () => Promise<unknown>;
}) {
  return <AssetBoard projects={[{ project: { ...project, id: projectId, name: project.name ?? "Project" }, ideas, models, batches, runs, assets }]} onRefresh={onRefresh} />;
}
