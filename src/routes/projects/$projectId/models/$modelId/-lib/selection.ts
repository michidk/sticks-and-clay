import type { ModelInspection } from "@/components/ui/model-viewer";
import type { ObjectReference } from "@/lib/object-reference";

export function objectReferenceFromNode(
  glb: string,
  inspection: ModelInspection | null,
  nodeId: string | null,
): ObjectReference | null {
  const node = inspection?.nodes.find((item) => item.id === nodeId && item.mesh);
  if (!node || !inspection) return null;
  return {
    glb,
    nodeId: node.id,
    name: node.name,
    path: inspection.nodes
      .filter((item) => node.id === item.id || node.id.startsWith(item.id + "/"))
      .sort((a, b) => a.depth - b.depth)
      .map((item) => item.name),
  };
}
