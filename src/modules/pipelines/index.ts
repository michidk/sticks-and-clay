export type PipelineNode<K extends string> = {
  id: string;
  task: K;
  iteration: number;
  next: string | null;
  /** A passing result ends the pipeline at this node. */
  stopOnPass?: boolean;
  stage?: "geometry" | "surface";
  passNext?: string;
  stopOnFail?: boolean;
};
export type Pipeline<K extends string> = {
  id: string;
  version: number;
  nodes: readonly PipelineNode<K>[];
};

/** Deterministic traversal. Handlers own durable step results and side effects.
 * Replaying traversal reuses those results; it never implies an API session resume.
 */
export async function runPipeline<K extends string>(
  pipeline: Pipeline<K>,
  handlers: Record<
    K,
    (node: PipelineNode<K>) => Promise<{ passed?: boolean } | void>
  >,
  beforeStep: () => Promise<void> = async () => {},
) {
  const nodes = new Map(pipeline.nodes.map((node) => [node.id, node]));
  if (nodes.size !== pipeline.nodes.length)
    throw new Error("Duplicate pipeline step ID");
  for (const node of nodes.values()) {
    if (node.next !== null && !nodes.has(node.next))
      throw new Error(`Missing pipeline step: ${node.next}`);
    if (node.passNext && !nodes.has(node.passNext))
      throw new Error(`Missing pipeline step: ${node.passNext}`);
    if (!handlers[node.task])
      throw new Error(`Missing task handler: ${node.task}`);
  }
  // Validate all conditional branches before side effects.
  const visiting = new Set<string>(),
    visited = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new Error("Unbounded pipeline cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    const node = nodes.get(id)!;
    if (node.next) visit(node.next);
    if (node.passNext) visit(node.passNext);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of nodes.keys()) visit(id);
  let id: string | null = pipeline.nodes[0]?.id ?? null;
  while (id !== null) {
    const node: PipelineNode<K> = nodes.get(id)!;
    await beforeStep();
    const result = await handlers[node.task](node);
    await beforeStep();
    if (node.stopOnPass && result?.passed) return;
    if (node.stopOnFail && !result?.passed) return;
    id = result?.passed && node.passNext ? node.passNext : node.next;
  }
}

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
