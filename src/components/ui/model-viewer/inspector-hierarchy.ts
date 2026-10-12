import type { ModelInspection } from "./model-inspection";

type Node = ModelInspection["nodes"][number];
const parentPath = (id: string) => id.slice(0, Math.max(0, id.lastIndexOf("/")));

/** Index parent paths once; searches walk each matching ancestor at most once. */
export function indexHierarchy(nodes: Node[]) {
  const parents = new Map<string, string>();
  const branches = new Set<string>();
  const names = new Map<string, string>();
  for (const node of nodes) {
    const parent = parentPath(node.id);
    parents.set(node.id, parent);
    branches.add(parent);
    names.set(node.id, node.name.toLowerCase());
  }
  return {
    branches,
    visible(query: string, collapsed: ReadonlySet<string>): Node[] {
      const normalized = query.toLowerCase();
      if (normalized) {
        const matching = new Set<string>();
        for (const node of nodes) {
          if (!names.get(node.id)!.includes(normalized)) continue;
          let id: string | undefined = node.id;
          while (id && !matching.has(id)) {
            matching.add(id);
            id = parents.get(id) ?? parentPath(id);
          }
        }
        return nodes.filter((node) => matching.has(node.id));
      }
      // Memoize hidden ancestry; standalone consumers need not sort parents
      // before children, and collapsed paths may refer to omitted groups.
      const hidden = new Map<string, boolean>();
      return nodes.filter((node) => {
        const chain: string[] = [];
        let id = node.id;
        let result = false;
        while (id) {
          if (hidden.has(id)) {
            result = hidden.get(id)!;
            break;
          }
          chain.push(id);
          const parent = parents.get(id) ?? parentPath(id);
          if (collapsed.has(parent)) {
            result = true;
            break;
          }
          id = parent;
        }
        for (const child of chain) hidden.set(child, result);
        return !result;
      });
    },
  };
}
