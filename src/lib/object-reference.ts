import { z } from "zod";

export const objectReferenceSchema = z.object({
  glb: z.string().min(1).max(1024),
  nodeId: z.string().regex(/^0(?:\/\d+)*$/).max(512),
  name: z.string().min(1).max(256),
  path: z.array(z.string().min(1).max(256)).min(1).max(64),
});
export type ObjectReference = z.infer<typeof objectReferenceSchema>;

export const MAX_OBJECT_REFERENCES = 8;
export const MAX_CHANGE_IMAGES = 4;

/** The parts a version references; versions saved before multi-part selection hold one. */
export function versionObjectReferences(version: {
  objectReference?: ObjectReference | null;
  objectReferences?: ObjectReference[] | null;
}): ObjectReference[] {
  return version.objectReferences?.length
    ? version.objectReferences
    : version.objectReference
      ? [version.objectReference]
      : [];
}

export function referencedChange(
  prompt: string,
  sourceRunId: string,
  reference?: ObjectReference | readonly ObjectReference[],
) {
  const references = reference ? [reference].flat() : [];
  if (!references.length) return prompt;
  // One part keeps the original wording, which saved checkpoints were built from.
  if (references.length === 1)
    return `${prompt}\n\nSelected object from saved version ${sourceRunId}:\n${JSON.stringify(references[0], null, 2)}\nResolve this reference against the supplied previous source using its object names and parent hierarchy. The viewer node ID is local to this GLB, not a Blender object ID. Preserve unrelated parts.`;
  return `${prompt}\n\nSelected objects from saved version ${sourceRunId}:\n${JSON.stringify(references, null, 2)}\nResolve these references against the supplied previous source using their object names and parent hierarchy. The viewer node IDs are local to this GLB, not Blender object IDs. Preserve unrelated parts.`;
}

/** Points the agents at the images the owner attached to this change; they lead the reference images. */
export function attachedImagesChange(prompt: string, images?: readonly string[] | null) {
  if (!images?.length) return prompt;
  const count = images.length === 1 ? "one image" : `${images.length} images`;
  return `${prompt}\n\nThe owner attached ${count} to illustrate this change. They are the first reference images after any approved visual target. Use them as visual evidence for the requested change, not as a replacement for the asset.`;
}
