export type PipelineNode<K extends string> = {
  id: string;
  task: K;
  iteration: number;
  next: string | null;
  /** A passing result ends the pipeline at this node. */
  stopOnPass?: boolean;
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
    if (!handlers[node.task])
      throw new Error(`Missing task handler: ${node.task}`);
  }
  // Validate before running any side effects. Bounded repetitions use distinct nodes.
  for (const start of nodes.keys()) {
    const seen = new Set<string>();
    let id: string | null = start;
    while (id !== null) {
      if (seen.has(id)) throw new Error("Unbounded pipeline cycle");
      seen.add(id);
      id = nodes.get(id)!.next;
    }
  }
  let id: string | null = pipeline.nodes[0]?.id ?? null;
  while (id !== null) {
    const node: PipelineNode<K> = nodes.get(id)!;
    await beforeStep();
    const result = await handlers[node.task](node);
    await beforeStep();
    if (node.stopOnPass && result?.passed) return;
    id = node.next;
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
