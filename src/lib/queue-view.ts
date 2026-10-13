import type { jobs, models, batches, projects, runs } from "../db/schema";

export const queueKindLabels: Record<string, string> = {
  design: "Design reference",
  "design-update": "Design revision",
  "design-from-model": "Design update from model",
  "project-name": "Project name draft",
  "project-brief": "Project brief draft",
  "model-brief": "Model brief draft",
  "graphic-brief": "Graphic brief draft",
  "design-mockups": "Design mockups",
  model: "Model build",
  plan: "Collection plan",
  demo: "Collection render",
  "project-photo": "Project photography",
  material: "PBR material",
  "material-assignment": "Material assignment",
  presentation: "Saved version render",
};

const roleLabels: Record<string, string> = {
  "visual-target": "Visual target",
  builder: "Build",
  photographer: "Photography",
  judge: "Judge",
  designer: "Design reference",
  "graphic-designer": "Design reference",
  planner: "Collection plan",
  "graphic-planner": "Collection plan",
  graphic: "Graphic",
  texture: "Texture",
  "material-builder": "Material build",
  "material-judge": "Material review",
  "material-planner": "Material plan",
};
/** Readable label for an AI role or queue kind. */
export function roleLabel(role: string) {
  const label =
    roleLabels[role] || queueKindLabels[role] || role.replaceAll("-", " ");
  return label[0].toUpperCase() + label.slice(1);
}

export function queueJobView(
  job: typeof jobs.$inferSelect,
  assets: Pick<
    typeof models.$inferSelect,
    "id" | "name" | "batchId" | "projectId" | "phase" | "progress"
  >[],
  collections: Pick<typeof batches.$inferSelect, "id" | "projectId">[],
  workspaces: Pick<
    typeof projects.$inferSelect,
    "id" | "name" | "phase" | "progress"
  >[],
) {
  const model = assets.find(
    (asset) =>
      asset.id ===
      (job.kind === "design-from-model"
        ? job.checkpoint.modelId
        : job.targetId),
  );
  const batch = collections.find((batch) => batch.id === job.targetId);
  const project = workspaces.find(
    (project) =>
      project.id === (model?.projectId || batch?.projectId || job.targetId),
  );
  const label = queueKindLabels[job.kind] || job.kind;
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    name: model ? `${label} · ${model.name}` : label,
    projectId: project?.id,
    modelId: model?.id,
    projectName: project?.name,
    phase:
      job.kind === "model"
        ? model?.phase
        : job.kind === "design"
          ? project?.phase
          : label,
    progress:
      job.status === "done"
        ? 100
        : job.kind === "model"
          ? model?.progress
          : job.kind === "design"
            ? project?.progress
            : job.kind === "project-photo" &&
                job.checkpoint["agent:photographer:0"]
              ? 60
              : 5,
  };
}

export function immediateRunView(
  run: Pick<
    typeof runs.$inferSelect,
    | "id"
    | "role"
    | "status"
    | "createdAt"
    | "finishedAt"
    | "error"
    | "projectId"
    | "modelId"
  >,
  project?: Pick<typeof projects.$inferSelect, "id" | "name">,
) {
  return {
    id: run.id,
    kind: run.role,
    status: run.status,
    createdAt: run.createdAt,
    startedAt: run.createdAt,
    finishedAt: run.finishedAt,
    error: run.error,
    name: queueKindLabels[run.role] || run.role,
    projectId: run.projectId,
    modelId: run.modelId || undefined,
    projectName: project?.name,
    canCancel: false,
  };
}
