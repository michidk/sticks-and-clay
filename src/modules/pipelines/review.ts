import type { Pipeline, PipelineNode } from "./index";

/** Explicitly expanded bounded review. Handlers own durable receipts and replay. */
export function assetReviewPipeline(
  rounds: number,
): Pipeline<"build" | "render" | "review"> {
  if (!Number.isInteger(rounds) || rounds < 0 || rounds > 5)
    throw new Error("Review rounds must be 0–5");
  const nodes: PipelineNode<"build" | "render" | "review">[] = [];
  for (let i = 0; i < Math.max(1, rounds); i++) {
    nodes.push({
      id: `build:${i}`,
      task: "build",
      iteration: i,
      next: `render:${i}`,
    });
    nodes.push({
      id: `render:${i}`,
      task: "render",
      iteration: i,
      next: rounds ? `review:${i}` : null,
    });
    if (rounds)
      nodes.push({
        id: `review:${i}`,
        task: "review",
        iteration: i,
        stopOnPass: true,
        next: i + 1 < rounds ? `build:${i + 1}` : null,
      });
  }
  return { id: "asset-review", version: 1, nodes };
}
