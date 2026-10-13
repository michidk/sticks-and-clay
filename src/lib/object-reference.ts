import { z } from "zod";

export const objectReferenceSchema = z.object({
  glb: z.string().min(1).max(1024),
  nodeId: z.string().regex(/^0(?:\/\d+)*$/).max(512),
  name: z.string().min(1).max(256),
  path: z.array(z.string().min(1).max(256)).min(1).max(64),
});
export type ObjectReference = z.infer<typeof objectReferenceSchema>;

export function referencedChange(
  prompt: string,
  sourceRunId: string,
  reference?: ObjectReference,
) {
  if (!reference) return prompt;
  return `${prompt}\n\nSelected object from saved version ${sourceRunId}:\n${JSON.stringify(reference, null, 2)}\nResolve this reference against the supplied previous source using its object names and parent hierarchy. The viewer node ID is local to this GLB, not a Blender object ID. Preserve unrelated parts.`;
}
