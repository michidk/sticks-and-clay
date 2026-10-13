export type PipelineNode<K extends string> = {
  id: string;
  task: K;
  iteration: number;
  metadata?: Readonly<Record<string, string | number | boolean>>;
  next: string | null;
  /** A passing result ends the pipeline at this node. */
  stopOnPass?: boolean;
  stage?: "geometry" | "surface";
  workPass?: "blockout" | "refinement" | "materials" | "polish";
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
