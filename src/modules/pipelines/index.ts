export { runPipeline } from "./traversal";
export type { Pipeline, PipelineNode } from "./traversal";
import type { Pipeline, PipelineNode } from "./traversal";

/** v1 preserves the original maximum build/review-pair semantics. */
export function modelReviewPipeline(
  judgeRounds: number,
): Pipeline<"builder" | "judge"> {
  if (!Number.isInteger(judgeRounds) || judgeRounds < 0 || judgeRounds > 5)
    throw new Error("Judge rounds must be an integer from 0 to 5");
  const nodes: PipelineNode<"builder" | "judge">[] = [];
  for (let iteration = 0; iteration < Math.max(1, judgeRounds); iteration++) {
    nodes.push({
      id: `builder:${iteration}`,
      task: "builder",
      iteration,
      next: judgeRounds ? `judge:${iteration}` : null,
    });
    if (judgeRounds)
      nodes.push({
        id: `judge:${iteration}`,
        task: "judge",
        iteration,
        stopOnPass: true,
        next: iteration + 1 < judgeRounds ? `builder:${iteration + 1}` : null,
      });
  }
  return { id: "model-review", version: 1, nodes };
}

/** Build → review → revise for any asset that is one artifact (SVG, raster graphics, …).
 * Up to N build/review pairs with early approval; zero rounds is a single unreviewed build.
 */
export function reviewPipeline(judgeRounds: number): Pipeline<"builder" | "judge"> {
  return { ...modelReviewPipeline(judgeRounds), id: "asset-review" };
}

/** Geometry is a hard gate before surface work. Zero rounds retains a single build. */
export function qualityPipeline(rounds: number): Pipeline<"builder" | "judge"> {
  modelReviewPipeline(rounds); // shared bounds
  if (!rounds)
    return { ...modelReviewPipeline(0), id: "model-quality", version: 2 };
  const nodes: PipelineNode<"builder" | "judge">[] = [];
  for (const stage of ["geometry", "surface"] as const) {
    for (let i = 0; i < rounds; i++) {
      const iteration = (stage === "geometry" ? 0 : rounds) + i;
      nodes.push({
        id: `builder:${iteration}`,
        task: "builder",
        iteration,
        stage,
        next: `judge:${iteration}`,
      });
      nodes.push({
        id: `judge:${iteration}`,
        task: "judge",
        iteration,
        stage,
        next: i + 1 < rounds ? `builder:${iteration + 1}` : null,
        ...(stage === "geometry"
          ? { passNext: `builder:${rounds}`, stopOnFail: i + 1 === rounds }
          : { stopOnPass: true }),
      });
    }
  }
  return { id: "model-quality", version: 2, nodes };
}

/** v3 photographs each exact export before review, including unreviewed builds. */
export function photographyPipeline(
  rounds: number,
): Pipeline<"builder" | "photographer" | "judge"> {
  const base = qualityPipeline(rounds);
  return {
    id: "model-quality",
    version: 3,
    nodes: base.nodes.flatMap(
      (node): PipelineNode<"builder" | "photographer" | "judge">[] =>
        node.task !== "builder"
          ? [node]
          : [
              { ...node, next: `photographer:${node.iteration}` },
              {
                id: `photographer:${node.iteration}`,
                task: "photographer",
                iteration: node.iteration,
                stage: node.stage,
                next: node.next,
              },
            ],
    ),
  };
}

/** v4 requires photographed development and refinement before either stage can pass.
 * Review rounds still bound judge calls per stage; zero disables only judging.
 */
export function refinementPipeline(
  rounds: number,
): Pipeline<"builder" | "photographer" | "judge"> {
  modelReviewPipeline(rounds);
  const nodes: PipelineNode<"builder" | "photographer" | "judge">[] = [];
  const stageBuilds = 1 + Math.max(1, rounds);
  for (const stage of ["geometry", "surface"] as const) {
    for (let i = 0; i < stageBuilds; i++) {
      const iteration = (stage === "geometry" ? 0 : stageBuilds) + i;
      const workPass =
        stage === "geometry"
          ? i === 0
            ? "blockout"
            : "refinement"
          : i === 0
            ? "materials"
            : "polish";
      const following =
        i + 1 < stageBuilds
          ? `builder:${iteration + 1}`
          : stage === "geometry" && !rounds
            ? `builder:${stageBuilds}`
            : null;
      nodes.push({
        id: `builder:${iteration}`,
        task: "builder",
        iteration,
        stage,
        workPass,
        next: `photographer:${iteration}`,
      });
      nodes.push({
        id: `photographer:${iteration}`,
        task: "photographer",
        iteration,
        stage,
        workPass,
        next: rounds && i > 0 ? `judge:${iteration}` : following,
      });
      if (rounds && i > 0)
        nodes.push({
          id: `judge:${iteration}`,
          task: "judge",
          iteration,
          stage,
          workPass,
          next: following,
          ...(stage === "geometry"
            ? {
                passNext: `builder:${stageBuilds}`,
                stopOnFail: i + 1 === stageBuilds,
              }
            : { stopOnPass: true }),
        });
    }
  }
  return { id: "model-quality", version: 4, nodes };
}
